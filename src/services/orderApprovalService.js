import {
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

import { getApprovalPricing } from "../utils/approvalPricing.js";

const itemKeys = ["id", "name", "price", "quantity", "subtotal"];
const drinkSizes = ["8oz", "12oz", "16oz"];

const resultError = (code, message, freshMenuItemsById) => {
  const error = new Error(message);
  error.code = code;
  return { error, freshMenuItemsById };
};

const samePricing = (confirmedPricing, currentPricing) => {
  if (
    !confirmedPricing
    || !Array.isArray(confirmedPricing.orderItems)
    || confirmedPricing.orderItems.length !== currentPricing.orderItems.length
    || confirmedPricing.total !== currentPricing.total
  ) {
    return false;
  }

  return confirmedPricing.orderItems.every((item, index) => {
    const currentItem = currentPricing.orderItems[index];
    return item
      && typeof item === "object"
      && !Array.isArray(item)
      && Object.keys(item).length === Object.keys(currentItem).length
      && [...itemKeys, ...(Object.hasOwn(currentItem, "size") ? ["size"] : [])]
        .every((key) => (
        Object.hasOwn(item, key) && item[key] === currentItem[key]
      ));
  });
};

const isPermissionDenied = (error) => (
  error?.code === "permission-denied"
  || error?.code === "firestore/permission-denied"
);

export const approveOrderRequest = async (
  database,
  requestId,
  reviewerUid,
  confirmedPricing,
) => {
  const freshMenuItemsById = new Map();
  const failed = (code, message) => (
    resultError(code, message, freshMenuItemsById)
  );

  if (
    typeof requestId !== "string"
    || !requestId
    || requestId !== requestId.trim()
    || requestId.includes("/")
    || requestId.length > 1500
    || typeof reviewerUid !== "string"
    || !reviewerUid
  ) {
    return failed("invalid-argument", "Approval details are invalid.");
  }

  const requestRef = doc(database, "orderRequests", requestId);
  const orderRef = doc(database, "orders", requestId);

  let requestSnapshot;
  let migrationSnapshot;
  let priceBookSnapshot;
  try {
    requestSnapshot = await getDoc(requestRef);
    if (!requestSnapshot.exists()) {
      return failed(
        "not-found",
        "This customer request no longer exists.",
      );
    }

    if (requestSnapshot.data().status !== "pending") {
      return failed(
        "failed-precondition",
        "This request is no longer pending and cannot be approved.",
      );
    }

    [migrationSnapshot, priceBookSnapshot] = await Promise.all([
      getDoc(doc(database, "menuControl", "migration")),
      getDoc(doc(database, "menuControl", "current")),
    ]);
  } catch (error) {
    if (isPermissionDenied(error)) {
      return failed(
        "permission-denied",
        "Permission denied. Administrator access is required to approve requests.",
      );
    }
    throw error;
  }

  if (
    !migrationSnapshot.exists()
    || migrationSnapshot.data().state !== "ready"
  ) {
    return failed(
      "failed-precondition",
      "Menu migration is not ready; order approvals are paused.",
    );
  }

  if (!priceBookSnapshot.exists()) {
    return failed(
      "failed-precondition",
      "The menu price book is unavailable; this request cannot be approved.",
    );
  }

  const currentRequest = requestSnapshot.data();
  const priceBook = priceBookSnapshot.data();
  if (
    !priceBook
    || !Number.isInteger(priceBook.revision)
    || priceBook.revision < 1
    || !priceBook.prices
    || typeof priceBook.prices !== "object"
    || Array.isArray(priceBook.prices)
    || !Array.isArray(currentRequest.items)
    || currentRequest.items.length < 1
    || currentRequest.items.length > 10
  ) {
    return failed(
      "failed-precondition",
      "The request or current price book is invalid.",
    );
  }

  const seenItems = new Set();
  for (const item of currentRequest.items) {
    const hasSize = item && Object.hasOwn(item, "size");
    if (
      !item
      || typeof item !== "object"
      || Array.isArray(item)
      || Object.keys(item).length !== (hasSize ? 3 : 2)
      || Object.keys(item).some((key) => !["id", "quantity", "size"].includes(key))
      || !Object.hasOwn(item, "id")
      || !Object.hasOwn(item, "quantity")
      || typeof item.id !== "string"
      || !item.id
      || item.id.length > 1500
      || item.id.includes("/")
      || !Number.isInteger(item.quantity)
      || item.quantity < 1
      || item.quantity > 99
      || (hasSize && !drinkSizes.includes(item.size))
      || seenItems.has(`${item.id}_${hasSize ? item.size : "default"}`)
    ) {
      return failed(
        "failed-precondition",
        "This request contains an invalid menu item or quantity.",
      );
    }
    seenItems.add(`${item.id}_${hasSize ? item.size : "default"}`);
  }

  const menuSnapshots = await Promise.all(
    currentRequest.items.map(({ id }) => getDoc(doc(database, "menuItems", id))),
  );
  const menuItemsById = new Map();

  for (const [index, menuSnapshot] of menuSnapshots.entries()) {
    const requestedItem = currentRequest.items[index];
    const menuItem = menuSnapshot.exists() ? menuSnapshot.data() : null;
    const priceEntry = priceBook.prices[requestedItem.id];

    if (
      !menuItem
      || !priceEntry
      || typeof menuItem.name !== "string"
      || !menuItem.name.trim()
      || menuItem.name.trim().length > 200
      || typeof menuItem.price !== "number"
      || !Number.isFinite(menuItem.price)
      || menuItem.price < 0
      || menuItem.price > 1000000
      || menuItem.available !== true
      || !Number.isInteger(menuItem.menuRevision)
      || !Number.isInteger(priceEntry.priceCents)
      || priceEntry.priceCents < 0
      || priceEntry.priceCents > 100000000
      || priceEntry.available !== true
      || !Number.isInteger(priceEntry.menuRevision)
      || menuItem.menuRevision !== priceEntry.menuRevision
      || Math.round(menuItem.price * 100) !== priceEntry.priceCents
    ) {
      return failed(
        "failed-precondition",
        `Menu or price-book data for "${requestedItem.id}" is missing, unavailable, or inconsistent.`,
      );
    }

    menuItemsById.set(requestedItem.id, {
      name: menuItem.name,
      price: menuItem.price,
      available: menuItem.available,
      ...(menuItem.sizes ? { sizes: menuItem.sizes } : {}),
      ...(priceEntry.sizePricesCents
        ? { sizePricesCents: priceEntry.sizePricesCents }
        : {}),
    });
  }

  const currentPricing = getApprovalPricing(currentRequest, menuItemsById);
  for (const error of currentPricing.errors) {
    return failed("failed-precondition", error);
  }

  for (const [id, menuItem] of menuItemsById) {
    freshMenuItemsById.set(id, menuItem);
  }

  if (!samePricing(confirmedPricing, currentPricing)) {
    return failed(
      "failed-precondition",
      "Current menu prices or item details changed. Review the updated summary and confirm again.",
    );
  }

  const order = {
    requestId,
    customerId: currentRequest.customerId,
    customerEmail: currentRequest.customerEmail,
    customerName: currentRequest.customerName,
    phone: currentRequest.phone,
    orderType: currentRequest.orderType,
    address: currentRequest.address,
    ...(Object.hasOwn(currentRequest, "deliveryLocation")
      ? { deliveryLocation: currentRequest.deliveryLocation }
      : {}),
    notes: currentRequest.notes,
    items: currentPricing.orderItems,
    total: currentPricing.total,
    status: "Pending",
    createdAt: serverTimestamp(),
  };
  const batch = writeBatch(database);
  batch.update(requestRef, {
    status: "approved",
    orderId: requestId,
    reviewedAt: serverTimestamp(),
    reviewedBy: reviewerUid,
  });
  batch.set(orderRef, order);

  try {
    await batch.commit();
    return { freshMenuItemsById };
  } catch (error) {
    if (!isPermissionDenied(error)) {
      throw error;
    }

    let latestRequest;
    try {
      latestRequest = await getDoc(requestRef);
    } catch (readError) {
      if (isPermissionDenied(readError)) {
        return failed(
          "permission-denied",
          "Permission denied. Administrator access is required to approve requests.",
        );
      }
      throw readError;
    }

    if (!latestRequest.exists()) {
      return failed("not-found", "This customer request no longer exists.");
    }
    if (latestRequest.data().status !== "pending") {
      return failed(
        "failed-precondition",
        "This request is no longer pending and cannot be approved.",
      );
    }

    return failed(
      "permission-denied",
      "Firestore denied the approval. Verify the request, migration state, and price book before retrying.",
    );
  }
};
