import { HttpsError } from "firebase-functions/v2/https";

export function priceMenuItems(requestedItems, menuSnapshots) {
  if (requestedItems.length !== menuSnapshots.length) {
    throw new HttpsError(
      "internal",
      "Unable to verify the selected menu items."
    );
  }

  let totalCents = 0;
  const items = requestedItems.map((requestedItem, index) => {
    const menuSnapshot = menuSnapshots[index];

    if (!menuSnapshot.exists) {
      throw new HttpsError(
        "failed-precondition",
        "A selected menu item is no longer available."
      );
    }

    const menuItem = menuSnapshot.data();

    if (
      menuItem.available !== undefined &&
      typeof menuItem.available !== "boolean"
    ) {
      throw new HttpsError(
        "failed-precondition",
        "A menu item has invalid availability settings."
      );
    }

    if (menuItem.available === false) {
      throw new HttpsError(
        "failed-precondition",
        `${menuItem.name || "A selected item"} is unavailable.`
      );
    }

    if (
      typeof menuItem.name !== "string" ||
      !menuItem.name.trim() ||
      typeof menuItem.price !== "number" ||
      !Number.isFinite(menuItem.price) ||
      menuItem.price < 0
    ) {
      throw new HttpsError(
        "failed-precondition",
        "A selected menu item has invalid price or name data."
      );
    }

    const priceCents = Math.round(menuItem.price * 100);
    const subtotalCents = priceCents * requestedItem.quantity;

    if (
      !Number.isSafeInteger(priceCents) ||
      !Number.isSafeInteger(subtotalCents) ||
      !Number.isSafeInteger(totalCents + subtotalCents)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "The order total is too large."
      );
    }

    totalCents += subtotalCents;

    return {
      id: menuSnapshot.id,
      name: menuItem.name.trim(),
      price: priceCents / 100,
      quantity: requestedItem.quantity,
      subtotal: subtotalCents / 100,
    };
  });

  return { items, total: totalCents / 100 };
}
