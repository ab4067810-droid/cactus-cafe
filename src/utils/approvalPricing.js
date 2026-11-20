const priceToCents = (price) => {
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
};

const drinkSizes = ["8oz", "12oz", "16oz"];

const getRequestedPriceCents = (requestedItem, menuItem) => {
  if (!Object.hasOwn(requestedItem, "size")) {
    return priceToCents(menuItem.price);
  }
  if (!drinkSizes.includes(requestedItem.size)) return null;

  const sizePricesCents = menuItem.sizePricesCents;
  const cents = sizePricesCents?.[requestedItem.size];
  if (
    Number.isInteger(cents)
    && cents >= 0
    && cents <= 100000000
  ) {
    return BigInt(cents);
  }

  const sizePrice = menuItem.sizes?.[requestedItem.size];
  if (
    typeof sizePrice !== "number"
    || !Number.isFinite(sizePrice)
    || sizePrice < 0
    || sizePrice > 1000000
  ) {
    return null;
  }
  return priceToCents(sizePrice);
};

export const getApprovalPricing = (request, menuItemsById) => {
  const errors = [];
  const rows = [];
  const orderItems = [];
  let totalCents = 0n;
  let totalAvailable = true;

  if (
    !Array.isArray(request.items)
    || request.items.length < 1
    || request.items.length > 10
  ) {
    errors.push("The request must contain between 1 and 10 item lines.");
    totalAvailable = false;
  }

  if (!menuItemsById) {
    errors.push("Current menu prices have not been loaded.");
    totalAvailable = false;
  }

  const requestedItems = Array.isArray(request.items) ? request.items : [];
  requestedItems.forEach((requestedItem, index) => {
    if (
      !requestedItem
      || typeof requestedItem.id !== "string"
      || !requestedItem.id
      || !Number.isInteger(requestedItem.quantity)
      || requestedItem.quantity < 1
      || requestedItem.quantity > 99
    ) {
      errors.push(
        `Item ${index + 1} has an invalid ID or quantity. Quantities must be whole numbers from 1 to 99.`
      );
      totalAvailable = false;
      rows.push({
        id: requestedItem?.id || `Item ${index + 1}`,
        name: requestedItem?.id || `Item ${index + 1}`,
        quantity: requestedItem?.quantity ?? "Invalid",
        price: null,
        subtotal: null,
      });
      return;
    }

    const menuItem = menuItemsById?.get(requestedItem.id);
    if (!menuItem) {
      errors.push(`Menu item "${requestedItem.id}" no longer exists.`);
      totalAvailable = false;
      rows.push({
        id: requestedItem.id,
        name: requestedItem.id,
        quantity: requestedItem.quantity,
        price: null,
        subtotal: null,
      });
      return;
    }

    if (
      menuItem.available !== undefined
      && typeof menuItem.available !== "boolean"
    ) {
      errors.push(`Menu item "${menuItem.name || requestedItem.id}" has invalid availability data.`);
    } else if (menuItem.available === false) {
      errors.push(`Menu item "${menuItem.name || requestedItem.id}" is unavailable.`);
    }

    const validName =
      typeof menuItem.name === "string"
      && Boolean(menuItem.name.trim())
      && menuItem.name.trim().length <= 200;
    const validPrice =
      typeof menuItem.price === "number"
      && Number.isFinite(menuItem.price)
      && menuItem.price >= 0
      && menuItem.price <= 1000000;
    const priceCents = getRequestedPriceCents(requestedItem, menuItem);

    if (!validName || !validPrice || priceCents === null) {
      errors.push(`Menu item "${requestedItem.id}" has an invalid name or price.`);
      totalAvailable = false;
      rows.push({
        id: requestedItem.id,
        name: validName ? menuItem.name.trim() : requestedItem.id,
        quantity: requestedItem.quantity,
        ...(Object.hasOwn(requestedItem, "size")
          ? { size: requestedItem.size }
          : {}),
        price: validPrice ? menuItem.price : null,
        subtotal: null,
      });
      return;
    }

    const subtotalCents = priceCents * BigInt(requestedItem.quantity);
    const nextTotalCents = totalCents + subtotalCents;
    if (
      priceCents > BigInt(Number.MAX_SAFE_INTEGER)
      || subtotalCents > BigInt(Number.MAX_SAFE_INTEGER)
      || nextTotalCents > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      errors.push("The calculated order total is too large to approve.");
      totalAvailable = false;
      rows.push({
        id: requestedItem.id,
        name: `${menuItem.name.trim()}${Object.hasOwn(requestedItem, "size") ? ` (${requestedItem.size})` : ""}`,
        quantity: requestedItem.quantity,
        ...(Object.hasOwn(requestedItem, "size")
          ? { size: requestedItem.size }
          : {}),
        price: Number(priceCents) / 100,
        subtotal: null,
      });
      return;
    }

    totalCents = nextTotalCents;
    const price = Number(priceCents) / 100;
    const subtotal = Number(subtotalCents) / 100;
    const name = `${menuItem.name.trim()}${Object.hasOwn(requestedItem, "size") ? ` (${requestedItem.size})` : ""}`;
    rows.push({
      id: requestedItem.id,
      name,
      quantity: requestedItem.quantity,
      ...(Object.hasOwn(requestedItem, "size")
        ? { size: requestedItem.size }
        : {}),
      price,
      subtotal,
    });
    orderItems.push({
      id: requestedItem.id,
      name,
      price,
      quantity: requestedItem.quantity,
      subtotal,
      ...(Object.hasOwn(requestedItem, "size")
        ? { size: requestedItem.size }
        : {}),
    });
  });

  return {
    errors: [...new Set(errors)],
    rows,
    orderItems,
    total: totalAvailable ? Number(totalCents) / 100 : null,
  };
};
