import { HttpsError } from "firebase-functions/v2/https";

function priceToCents(price) {
  const [coefficient, exponentPart] = price.toString().toLowerCase().split("e");
  const [whole, fraction = ""] = coefficient.split(".");
  const value = BigInt(`${whole}${fraction}`);
  const scale = Number(exponentPart || 0) - fraction.length + 2;

  if (scale >= 0) {
    return value * 10n ** BigInt(scale);
  }

  const divisor = 10n ** BigInt(-scale);
  const cents = value / divisor;
  const remainder = value % divisor;
  return remainder * 2n >= divisor ? cents + 1n : cents;
}

export function priceMenuItems(requestedItems, menuSnapshots) {
  if (requestedItems.length !== menuSnapshots.length) {
    throw new HttpsError(
      "internal",
      "Unable to verify the selected menu items."
    );
  }

  let totalCents = 0n;
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

    if (
      !Number.isSafeInteger(requestedItem.quantity) ||
      requestedItem.quantity <= 0
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Item quantities must be positive whole numbers."
      );
    }

    const priceCents = priceToCents(menuItem.price);
    const subtotalCents = priceCents * BigInt(requestedItem.quantity);
    const orderTotalCents = totalCents + subtotalCents;

    if (
      priceCents > BigInt(Number.MAX_SAFE_INTEGER) ||
      subtotalCents > BigInt(Number.MAX_SAFE_INTEGER) ||
      orderTotalCents > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "The order total is too large."
      );
    }

    totalCents = orderTotalCents;

    return {
      id: menuSnapshot.id,
      name: menuItem.name.trim(),
      price: Number(priceCents) / 100,
      quantity: requestedItem.quantity,
      subtotal: Number(subtotalCents) / 100,
    };
  });

  return { items, total: Number(totalCents) / 100 };
}
