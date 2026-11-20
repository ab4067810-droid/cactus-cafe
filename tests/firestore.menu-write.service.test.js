import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
} from "firebase/firestore";

import {
  createMenuWriteService,
  MenuWriteConflictError,
} from "../src/services/menuWriteService.js";

const projectId = "demo-cactus-cafe-menu-write-service";
const rules = readFileSync(
  process.env.FIRESTORE_RULES_PATH
    || new URL("../firestore.rules", import.meta.url),
  "utf8",
);

let testEnv;

const menuItem = (overrides = {}) => ({
  name: "Cactus Latte",
  category: "Coffee",
  description: "Espresso with steamed milk.",
  price: 4.25,
  imageUrl: "https://example.test/latte.jpg",
  available: true,
  featured: false,
  popular: false,
  createdAt: Timestamp.fromMillis(1),
  menuRevision: 1,
  ...overrides,
});

const priceEntry = (overrides = {}) => ({
  priceCents: 425,
  available: true,
  menuRevision: 1,
  ...overrides,
});

async function seedItem(id = "coffee", item = menuItem()) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, `menuItems/${id}`), item),
      setDoc(doc(database, "menuControl/current"), {
        revision: 1,
        updatedAt: Timestamp.fromMillis(1),
        lastChangedMenuItemId: id,
        prices: { [id]: priceEntry() },
      }),
    ]);
  });
}

async function readItemAndBook(database, id = "coffee") {
  const [itemSnapshot, bookSnapshot] = await Promise.all([
    getDoc(doc(database, `menuItems/${id}`)),
    getDoc(doc(database, "menuControl/current")),
  ]);
  return {
    item: itemSnapshot.data(),
    book: bookSnapshot.data(),
  };
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    const now = Timestamp.fromMillis(1);
    await Promise.all([
      setDoc(doc(database, "users/admin-1"), { role: "admin" }),
      setDoc(doc(database, "users/admin-2"), { role: "admin" }),
      setDoc(doc(database, "users/customer-1"), { role: "customer" }),
      setDoc(doc(database, "migrationOperators/admin-1"), { enabled: true }),
      setDoc(doc(database, "menuControl/migration"), {
        state: "ready",
        startedAt: now,
        updatedAt: now,
        updatedBy: "admin-1",
      }),
    ]);
  });
});

describe("menu write service", () => {
  it("allows an ordinary administrator to create, update, and delete menu items while ready", async () => {
    await seedItem();
    const database = testEnv.authenticatedContext("admin-2").firestore();
    const service = createMenuWriteService(database);

    const created = await service.createMenuItem({
      name: "Cactus Tea",
      price: 2.5,
      available: true,
    });
    await service.setMenuItemAvailability("coffee", false, {
      expectedMenuRevision: 1,
    });
    await service.deleteMenuItem(created.id, {
      expectedMenuRevision: 1,
    });

    const { item, book } = await readItemAndBook(database);
    const deletedItem = await getDoc(doc(database, `menuItems/${created.id}`));
    assert.equal(item.available, false);
    assert.equal(book.prices.coffee.available, false);
    assert.equal(deletedItem.exists(), false);
  });

  it("updates availability and synchronizes only the matching price-book entry", async () => {
    await seedItem();
    const database = testEnv.authenticatedContext("admin-1").firestore();
    const service = createMenuWriteService(database);

    await service.setMenuItemAvailability("coffee", false, {
      expectedMenuRevision: 1,
    });

    const { item, book } = await readItemAndBook(database);
    assert.equal(item.available, false);
    assert.equal(item.menuRevision, 2);
    assert.equal(item.featured, false);
    assert.equal(item.name, "Cactus Latte");
    assert.equal(item.createdAt.toMillis(), 1);
    assert.equal(book.revision, 2);
    assert.equal(book.lastChangedMenuItemId, "coffee");
    assert.ok(book.updatedAt instanceof Timestamp);
    assert.deepEqual(book.prices.coffee, {
      priceCents: 425,
      available: false,
      menuRevision: 2,
    });
  });

  it("updates featured independently while preserving availability and menu data", async () => {
    await seedItem();
    const database = testEnv.authenticatedContext("admin-1").firestore();
    const service = createMenuWriteService(database);

    await service.setMenuItemFeatured("coffee", true, {
      expectedMenuRevision: 1,
    });

    const { item, book } = await readItemAndBook(database);
    assert.equal(item.featured, true);
    assert.equal(item.available, true);
    assert.equal(item.menuRevision, 2);
    assert.equal(item.description, "Espresso with steamed milk.");
    assert.equal(book.revision, 2);
    assert.deepEqual(book.prices.coffee, {
      priceCents: 250,
      available: true,
      menuRevision: 2,
    });
  });

  it("creates an item and updates the existing price book without losing entries", async () => {
    await seedItem();
    const database = testEnv.authenticatedContext("admin-1").firestore();
    const service = createMenuWriteService(database);

    const result = await service.createMenuItem({
      name: "Cactus Tea",
      category: "Tea",
      description: "Freshly brewed tea.",
      price: 3.75,
      available: true,
      featured: true,
    });

    const { book } = await readItemAndBook(database);
    const created = await getDoc(doc(database, `menuItems/${result.id}`));
    assert.equal(created.data().menuRevision, 1);
    assert.equal(created.data().name, "Cactus Tea");
    assert.equal(book.revision, 2);
    assert.deepEqual(Object.keys(book.prices).sort(), [result.id, "coffee"].sort());
    assert.deepEqual(book.prices[result.id], {
      priceCents: 375,
      available: true,
      menuRevision: 1,
    });
    assert.deepEqual(book.prices.coffee, priceEntry());
  });

  it("synchronizes drink size prices and removes them when the category changes", async () => {
    await seedItem();
    const database = testEnv.authenticatedContext("admin-1").firestore();
    const service = createMenuWriteService(database);
    const sizes = { "8oz": 2.5, "12oz": 3.25, "16oz": 4 };

    await service.updateMenuItem(
      "coffee",
      {
        category: "Soda",
        price: sizes["8oz"],
        sizes,
      },
      { expectedMenuRevision: 1 },
    );

    let { item, book } = await readItemAndBook(database);
    assert.deepEqual(item.sizes, sizes);
    assert.equal(item.price, sizes["8oz"]);
    assert.deepEqual(book.prices.coffee, {
      priceCents: 425,
      available: true,
      menuRevision: 2,
      sizePricesCents: {
        "8oz": 250,
        "12oz": 325,
        "16oz": 400,
      },
    });

    await service.updateMenuItem(
      "coffee",
      { category: "Coffee", price: 5 },
      { expectedMenuRevision: 2 },
    );

    ({ item, book } = await readItemAndBook(database));
    assert.equal(Object.hasOwn(item, "sizes"), false);
    assert.equal(Object.hasOwn(book.prices.coffee, "sizePricesCents"), false);
    assert.equal(book.prices.coffee.priceCents, 500);
  });

  it("rejects a menu and price-book update with mismatched size prices", async () => {
    await seedItem();
    const database = testEnv.authenticatedContext("admin-1").firestore();
    const batch = writeBatch(database);
    const sizes = { "8oz": 2.5, "12oz": 3.25, "16oz": 4 };

    batch.update(doc(database, "menuItems/coffee"), {
      price: sizes["8oz"],
      sizes,
      menuRevision: 2,
    });
    batch.update(doc(database, "menuControl/current"), {
      revision: 2,
      updatedAt: serverTimestamp(),
      lastChangedMenuItemId: "coffee",
      prices: {
        coffee: {
          priceCents: 250,
          available: true,
          menuRevision: 2,
          sizePricesCents: {
            "8oz": 250,
            "12oz": 300,
            "16oz": 400,
          },
        },
      },
    });

    await assert.rejects(
      batch.commit(),
      (error) => error.code === "permission-denied",
    );
    const { item, book } = await readItemAndBook(database);
    assert.equal(item.menuRevision, 1);
    assert.equal(Object.hasOwn(item, "sizes"), false);
    assert.equal(book.revision, 1);
  });

  it("creates the initial price book atomically when it does not exist", async () => {
    const database = testEnv.authenticatedContext("admin-1").firestore();
    const service = createMenuWriteService(database);

    const result = await service.createMenuItem({
      name: "Cactus Coffee",
      price: 2.5,
      available: true,
    });
    const { item, book } = await readItemAndBook(database, result.id);

    assert.equal(item.menuRevision, 1);
    assert.equal(book.revision, 1);
    assert.equal(book.lastChangedMenuItemId, result.id);
    assert.deepEqual(book.prices[result.id], {
      priceCents: 250,
      available: true,
      menuRevision: 1,
    });
  });

  it("deletes an item and removes only its price-book entry", async () => {
    await seedItem();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await Promise.all([
        setDoc(doc(database, "menuItems/tea"), menuItem({
          name: "Cactus Tea",
          price: 3.25,
        })),
        setDoc(doc(database, "menuControl/current"), {
          revision: 1,
          updatedAt: Timestamp.fromMillis(1),
          lastChangedMenuItemId: "coffee",
          prices: {
            coffee: priceEntry(),
            tea: priceEntry({ priceCents: 325 }),
          },
        }),
      ]);
    });
    const database = testEnv.authenticatedContext("admin-1").firestore();
    const service = createMenuWriteService(database);

    await service.deleteMenuItem("tea", { expectedMenuRevision: 1 });

    const [deletedItem, bookSnapshot] = await Promise.all([
      getDoc(doc(database, "menuItems/tea")),
      getDoc(doc(database, "menuControl/current")),
    ]);
    assert.equal(deletedItem.exists(), false);
    assert.equal(bookSnapshot.data().revision, 2);
    assert.deepEqual(Object.keys(bookSnapshot.data().prices), ["coffee"]);
    assert.deepEqual(bookSnapshot.data().prices.coffee, priceEntry());
  });

  it("reports a stale expected revision without writing", async () => {
    await seedItem();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(
        doc(database, "menuItems/coffee"),
        menuItem({ menuRevision: 2 }),
      );
      await setDoc(doc(database, "menuControl/current"), {
        revision: 2,
        updatedAt: Timestamp.fromMillis(2),
        lastChangedMenuItemId: "coffee",
        prices: {
          coffee: priceEntry({ menuRevision: 2 }),
        },
      });
    });
    const database = testEnv.authenticatedContext("admin-1").firestore();
    const service = createMenuWriteService(database);

    await assert.rejects(
      service.setMenuItemFeatured("coffee", true, {
        expectedMenuRevision: 1,
      }),
      (error) => error instanceof MenuWriteConflictError
        && error.code === "menu/stale-revision",
    );

    const { item, book } = await readItemAndBook(database);
    assert.equal(item.featured, false);
    assert.equal(item.menuRevision, 2);
    assert.equal(book.revision, 2);
  });

  it("does not allow a non-administrator to modify the menu", async () => {
    await seedItem();
    const database = testEnv.authenticatedContext("customer-1").firestore();
    const service = createMenuWriteService(database);

    await assert.rejects(
      service.setMenuItemAvailability("coffee", false),
      (error) => error.code === "permission-denied",
    );

    const verificationDatabase = testEnv.authenticatedContext("admin-1").firestore();
    const { item, book } = await readItemAndBook(verificationDatabase);
    assert.equal(item.available, true);
    assert.equal(item.menuRevision, 1);
    assert.equal(book.revision, 1);
  });
});
