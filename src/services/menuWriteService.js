import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

const PRICE_BOOK_PATH = "menuControl/current";
const MENU_ITEMS_COLLECTION = "menuItems";
const DRINK_SIZES = ["8oz", "12oz", "16oz"];

export class MenuWriteConflictError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "MenuWriteConflictError";
    this.code = "menu/stale-revision";
  }
}

function priceEntryFor(menuItem, menuRevision) {
  return {
    priceCents: Math.round(menuItem.price * 100),
    available: menuItem.available,
    menuRevision,
    ...(Object.hasOwn(menuItem, "sizes")
      ? {
          sizePricesCents: Object.fromEntries(
            DRINK_SIZES.map((size) => [
              size,
              Math.round(menuItem.sizes[size] * 100),
            ]),
          ),
        }
      : {}),
  };
}

function readPriceBook(snapshot) {
  if (!snapshot.exists()) return null;

  const data = snapshot.data();
  const expectedKeys = [
    "revision",
    "updatedAt",
    "lastChangedMenuItemId",
    "prices",
  ];
  if (
    Object.keys(data).length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(data, key))
    || !Number.isInteger(data.revision)
    || data.revision < 1
    || !data.prices
    || typeof data.prices !== "object"
    || Array.isArray(data.prices)
  ) {
    throw new Error("The menu price book has an invalid structure.");
  }

  return data;
}

function validateMenuItem(menuItem) {
  if (
    typeof menuItem.price !== "number"
    || !Number.isFinite(menuItem.price)
    || menuItem.price < 0
    || menuItem.price > 1000000
    || typeof menuItem.available !== "boolean"
  ) {
    throw new Error("Menu item price or availability is invalid.");
  }

  if (Object.hasOwn(menuItem, "sizes")) {
    const sizes = menuItem.sizes;
    if (
      !sizes
      || typeof sizes !== "object"
      || Array.isArray(sizes)
      || Object.keys(sizes).length !== DRINK_SIZES.length
      || DRINK_SIZES.some((size) => (
        !Object.hasOwn(sizes, size)
        || typeof sizes[size] !== "number"
        || !Number.isFinite(sizes[size])
        || sizes[size] < 0
        || sizes[size] > 1000000
      ))
      || menuItem.price !== sizes["8oz"]
    ) {
      throw new Error("Menu item size prices are invalid.");
    }
  }
}

function isSizeVariantCategory(value) {
  return ["soda", "milktea"].includes(
    String(value || "").trim().toLowerCase().replace(/\s+/g, ""),
  );
}

function validateExpectedRevision(expectedMenuRevision) {
  if (
    expectedMenuRevision !== undefined
    && (!Number.isInteger(expectedMenuRevision) || expectedMenuRevision < 1)
  ) {
    throw new Error("Expected menu revision must be a positive integer.");
  }
}

function hasPermissionDeniedCode(error) {
  return error?.code === "permission-denied"
    || error?.code === "firestore/permission-denied";
}

export function createMenuWriteService(database) {
  if (!database) {
    throw new Error("A Firestore database instance is required.");
  }

  const priceBookRef = doc(database, PRICE_BOOK_PATH);

  const reportConcurrentRevision = async (
    error,
    menuItemRef,
    expectedMenuRevision,
    expectedPriceBookRevision,
  ) => {
    if (!hasPermissionDeniedCode(error)) throw error;

    let currentMenuSnapshot;
    let currentPriceBookSnapshot;
    try {
      [currentMenuSnapshot, currentPriceBookSnapshot] = await Promise.all([
        getDoc(menuItemRef),
        getDoc(priceBookRef),
      ]);
    } catch (verificationError) {
      throw new AggregateError(
        [error, verificationError],
        "The menu write was denied and the current revisions could not be verified.",
        { cause: verificationError },
      );
    }

    const currentMenuRevision = currentMenuSnapshot.exists()
      ? currentMenuSnapshot.data().menuRevision ?? null
      : null;
    const currentPriceBookRevision = currentPriceBookSnapshot.exists()
      ? currentPriceBookSnapshot.data().revision
      : null;

    if (
      currentMenuRevision !== expectedMenuRevision
      || currentPriceBookRevision !== expectedPriceBookRevision
    ) {
      throw new MenuWriteConflictError(
        "The menu changed while this write was in progress. Reload the menu and try again.",
        { cause: error },
      );
    }

    throw error;
  };

  const commitItemAndPriceBook = async ({
    menuItemRef,
    menuItem,
    priceBook,
    priceBookSnapshot,
    operation,
    expectedMenuRevision,
  }) => {
    const batch = writeBatch(database);
    const currentMenuRevision = menuItem?.menuRevision ?? null;
    if (
      currentMenuRevision !== null
      && (!Number.isInteger(currentMenuRevision) || currentMenuRevision < 1)
    ) {
      throw new Error("The menu item has an invalid revision.");
    }

    if (expectedMenuRevision !== undefined) {
      validateExpectedRevision(expectedMenuRevision);
      if (currentMenuRevision !== expectedMenuRevision) {
        throw new MenuWriteConflictError(
          "The menu item has changed. Reload it before saving.",
        );
      }
    }

    const currentPriceBookRevision = priceBook?.revision ?? null;
    const nextMenuRevision = currentMenuRevision === null
      ? 1
      : currentMenuRevision + 1;

    if (operation === "create") {
      batch.set(menuItemRef, {
        ...menuItem,
        menuRevision: 1,
      });

      if (priceBookSnapshot.exists()) {
        if (Object.hasOwn(priceBook.prices, menuItemRef.id)) {
          throw new Error(
            `The price book already contains an unpaired entry for "${menuItemRef.id}".`,
          );
        }
        batch.update(priceBookRef, {
          revision: priceBook.revision + 1,
          updatedAt: serverTimestamp(),
          lastChangedMenuItemId: menuItemRef.id,
          prices: {
            ...priceBook.prices,
            [menuItemRef.id]: priceEntryFor(menuItem, 1),
          },
        });
      } else {
        batch.set(priceBookRef, {
          revision: 1,
          updatedAt: serverTimestamp(),
          lastChangedMenuItemId: menuItemRef.id,
          prices: {
            [menuItemRef.id]: priceEntryFor(menuItem, 1),
          },
        });
      }
    } else if (operation === "update") {
      const nextMenuItem = {
        ...menuItem,
        menuRevision: nextMenuRevision,
        updatedAt: serverTimestamp(),
      };
      validateMenuItem(nextMenuItem);

      batch.update(menuItemRef, nextMenuItem);
      batch.update(priceBookRef, {
        revision: priceBook.revision + 1,
        updatedAt: serverTimestamp(),
        lastChangedMenuItemId: menuItemRef.id,
        prices: {
          ...priceBook.prices,
          [menuItemRef.id]: priceEntryFor(nextMenuItem, nextMenuRevision),
        },
      });
    } else {
      batch.delete(menuItemRef);
      const remainingPrices = Object.fromEntries(
        Object.entries(priceBook.prices)
          .filter(([itemId]) => itemId !== menuItemRef.id),
      );
      batch.update(priceBookRef, {
        revision: priceBook.revision + 1,
        updatedAt: serverTimestamp(),
        lastChangedMenuItemId: menuItemRef.id,
        prices: remainingPrices,
      });
    }

    try {
      await batch.commit();
    } catch (error) {
      await reportConcurrentRevision(
        error,
        menuItemRef,
        currentMenuRevision,
        currentPriceBookRevision,
      );
    }

    return {
      id: menuItemRef.id,
      menuRevision: operation === "delete" ? undefined : nextMenuRevision,
      priceBookRevision: operation === "create" && !priceBookSnapshot.exists()
        ? 1
        : currentPriceBookRevision + 1,
    };
  };

  const createMenuItem = async (menuItem, { id } = {}) => {
    if (!menuItem || typeof menuItem !== "object" || Array.isArray(menuItem)) {
      throw new Error("Menu item data must be an object.");
    }

    const menuItemRef = id
      ? doc(database, MENU_ITEMS_COLLECTION, id)
      : doc(collection(database, MENU_ITEMS_COLLECTION));
    const [existingMenuSnapshot, priceBookSnapshot] = await Promise.all([
      getDoc(menuItemRef),
      getDoc(priceBookRef),
    ]);

    if (existingMenuSnapshot.exists()) {
      throw new Error(`Menu item "${menuItemRef.id}" already exists.`);
    }

    const priceBook = readPriceBook(priceBookSnapshot);
    const newMenuItem = {
      ...menuItem,
      createdAt: menuItem.createdAt ?? serverTimestamp(),
      available: menuItem.available,
    };
    validateMenuItem(newMenuItem);

    return commitItemAndPriceBook({
      menuItemRef,
      menuItem: newMenuItem,
      priceBook,
      priceBookSnapshot,
      operation: "create",
    });
  };

  const updateMenuItem = async (
    id,
    changes,
    { expectedMenuRevision } = {},
  ) => {
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      throw new Error("Menu item changes must be an object.");
    }
    if (
      Object.hasOwn(changes, "menuRevision")
      || Object.hasOwn(changes, "id")
      || Object.hasOwn(changes, "createdAt")
      || Object.hasOwn(changes, "updatedAt")
    ) {
      throw new Error("Menu revision and timestamps are managed by the service.");
    }
    if (Object.keys(changes).length === 0) {
      throw new Error("At least one menu item field must be changed.");
    }
    if (
      (Object.hasOwn(changes, "featured")
        && typeof changes.featured !== "boolean")
      || (Object.hasOwn(changes, "popular")
        && typeof changes.popular !== "boolean")
    ) {
      throw new Error("Featured and popular values must be booleans.");
    }

    const menuItemRef = doc(database, MENU_ITEMS_COLLECTION, id);
    const [menuSnapshot, priceBookSnapshot] = await Promise.all([
      getDoc(menuItemRef),
      getDoc(priceBookRef),
    ]);
    if (!menuSnapshot.exists()) {
      throw new Error(`Menu item "${id}" does not exist.`);
    }

    const priceBook = readPriceBook(priceBookSnapshot);
    if (!priceBook || !Object.hasOwn(priceBook.prices, id)) {
      throw new Error(`Menu item "${id}" has no matching price-book entry.`);
    }

    const currentMenuItem = menuSnapshot.data();
    const updatedMenuItem = {
      ...currentMenuItem,
      ...changes,
    };
    if (
      Object.hasOwn(changes, "category")
      && !isSizeVariantCategory(changes.category)
    ) {
      delete updatedMenuItem.sizes;
    }
    validateMenuItem(updatedMenuItem);

    return commitItemAndPriceBook({
      menuItemRef,
      menuItem: updatedMenuItem,
      priceBook,
      priceBookSnapshot,
      operation: "update",
      expectedMenuRevision,
    });
  };

  const deleteMenuItem = async (id, { expectedMenuRevision } = {}) => {
    validateExpectedRevision(expectedMenuRevision);

    const menuItemRef = doc(database, MENU_ITEMS_COLLECTION, id);
    const [menuSnapshot, priceBookSnapshot] = await Promise.all([
      getDoc(menuItemRef),
      getDoc(priceBookRef),
    ]);
    if (!menuSnapshot.exists()) {
      throw new Error(`Menu item "${id}" does not exist.`);
    }

    const priceBook = readPriceBook(priceBookSnapshot);
    if (!priceBook || !Object.hasOwn(priceBook.prices, id)) {
      throw new Error(`Menu item "${id}" has no matching price-book entry.`);
    }

    return commitItemAndPriceBook({
      menuItemRef,
      menuItem: menuSnapshot.data(),
      priceBook,
      priceBookSnapshot,
      operation: "delete",
      expectedMenuRevision,
    });
  };

  return {
    createMenuItem,
    updateMenuItem,
    setMenuItemAvailability: (id, available, options) => {
      if (typeof available !== "boolean") {
        throw new Error("Availability must be a boolean.");
      }
      return updateMenuItem(id, { available }, options);
    },
    setMenuItemFeatured: (id, featured, options) => {
      if (typeof featured !== "boolean") {
        throw new Error("Featured must be a boolean.");
      }
      return updateMenuItem(id, { featured }, options);
    },
    deleteMenuItem,
  };
}
