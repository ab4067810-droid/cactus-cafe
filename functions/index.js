import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { priceMenuItems } from "./orderPricing.js";

initializeApp();

const db = getFirestore();
const MAX_CART_LINES = 50;
const ORDER_TYPES = new Set(["takeout", "delivery", "dine-in"]);

function requiredText(value, field, maxLength) {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${field} is required.`);
  }

  const text = value.trim();

  if (!text || text.length > maxLength) {
    throw new HttpsError("invalid-argument", `${field} is invalid.`);
  }

  return text;
}

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${field} is invalid.`);
  }

  const text = value.trim();

  if (text.length > maxLength) {
    throw new HttpsError("invalid-argument", `${field} is too long.`);
  }

  return text;
}

function validateItems(items) {
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > MAX_CART_LINES
  ) {
    throw new HttpsError(
      "invalid-argument",
      `Provide between 1 and ${MAX_CART_LINES} different menu items.`
    );
  }

  const seenIds = new Set();

  return items.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).some((key) => !["id", "quantity"].includes(key))
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Each item must contain only a menu item ID and quantity."
      );
    }

    if (
      typeof item.id !== "string" ||
      !item.id.trim() ||
      item.id.trim().length > 1500
    ) {
      throw new HttpsError("invalid-argument", "A menu item ID is invalid.");
    }

    const id = item.id.trim();

    if (seenIds.has(id)) {
      throw new HttpsError(
        "invalid-argument",
        "Each menu item may appear only once."
      );
    }

    seenIds.add(id);

    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new HttpsError(
        "invalid-argument",
        "Item quantities must be positive whole numbers."
      );
    }

    return { id, quantity: item.quantity };
  });
}

export const createOrder = onCall(
  { region: "asia-southeast1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Please log in before placing an order."
      );
    }

    const data = request.data;

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new HttpsError("invalid-argument", "Order details are invalid.");
    }

    const allowedFields = new Set([
      "items",
      "customerName",
      "phone",
      "orderType",
      "address",
      "notes",
    ]);

    if (Object.keys(data).some((key) => !allowedFields.has(key))) {
      throw new HttpsError(
        "invalid-argument",
        "Do not include prices, totals, status, or customer IDs."
      );
    }

    const customerName = requiredText(data.customerName, "Customer name", 120);
    const phone = requiredText(data.phone, "Phone number", 40);
    const orderType = data.orderType;

    if (typeof orderType !== "string" || !ORDER_TYPES.has(orderType)) {
      throw new HttpsError("invalid-argument", "The order type is invalid.");
    }

    const address = optionalText(data.address, "Delivery address", 500);
    const notes = optionalText(data.notes, "Order notes", 1000);

    if (orderType === "delivery" && !address) {
      throw new HttpsError(
        "invalid-argument",
        "A delivery address is required."
      );
    }

    const requestedItems = validateItems(data.items);
    const menuSnapshots = await Promise.all(
      requestedItems.map(({ id }) => db.collection("menuItems").doc(id).get())
    );
    const { items, total } = priceMenuItems(
      requestedItems,
      menuSnapshots
    );

    const order = {
      customerId: request.auth.uid,
      customerEmail:
        typeof request.auth.token.email === "string"
          ? request.auth.token.email
          : "",
      customerName,
      phone,
      orderType,
      address: orderType === "delivery" ? address : "",
      notes,
      items,
      total,
      status: "Pending",
      createdAt: FieldValue.serverTimestamp(),
    };

    const orderRef = await db.collection("orders").add(order);

    return { orderId: orderRef.id, total: order.total };
  }
);
