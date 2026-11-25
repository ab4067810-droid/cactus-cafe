import {
  getCanonicalDeliveryBarangay,
  normalizeBarangayName,
} from "./deliveryScope.js";

const DELIVERY_FEES = Object.freeze({
  "Barangay 1 Poblacion": 20,
  "Barangay 2 Poblacion": 20,
  "Barangay 3 Poblacion": 20,
  "Barangay 4 Poblacion": 20,
  "Barangay 5 Poblacion": 20,
  "Barangay 6 Poblacion": 20,
  "Barangay 7 Poblacion": 20,
  "Barangay 8 Poblacion": 20,
  "Barangay 9 Poblacion": 20,
  Rumirang: 50,
  Guintubhan: 50,
  Camangcamang: 60,
  Tinongan: 60,
  Maytubig: 60,
});

const DELIVERY_BARANGAY_ALIASES = Object.freeze({
  camang2: "Camangcamang",
  tinonganproper: "Tinongan",
});

export function getDeliveryFeeForBarangay(barangay) {
  const canonicalBarangay = getCanonicalDeliveryBarangay(barangay)
    || DELIVERY_BARANGAY_ALIASES[normalizeBarangayName(barangay)];
  return canonicalBarangay ? DELIVERY_FEES[canonicalBarangay] ?? null : null;
}

export function getOrderApprovalPricing(request, menuItemsById, getItemPricing) {
  const itemPricing = getItemPricing(request, menuItemsById);
  if (request?.orderType !== "delivery") {
    return {
      ...itemPricing,
      itemsSubtotal: itemPricing.total,
      deliveryFee: 0,
    };
  }

  const expectedFee = getDeliveryFeeForBarangay(request.deliveryBarangay);
  if (
    expectedFee === null
    || request.deliveryFee !== expectedFee
  ) {
    return {
      ...itemPricing,
      errors: [...itemPricing.errors, "The delivery barangay or fee is invalid."],
      itemsSubtotal: itemPricing.total,
      deliveryFee: null,
      total: null,
    };
  }

  return {
    ...itemPricing,
    itemsSubtotal: itemPricing.total,
    deliveryFee: expectedFee,
    total: itemPricing.total === null ? null : itemPricing.total + expectedFee,
  };
}
