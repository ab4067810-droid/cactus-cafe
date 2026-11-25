import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getDeliveryFeeForBarangay,
  getOrderApprovalPricing,
} from "../src/utils/deliveryFees.js";

describe("Isabela delivery fee schedule", () => {
  it("applies the fee for all covered barangays and common checkout labels", () => {
    for (let number = 1; number <= 9; number += 1) {
      assert.equal(
        getDeliveryFeeForBarangay(`Barangay ${number} (Poblacion)`),
        20,
      );
    }

    assert.equal(getDeliveryFeeForBarangay("Rumirang"), 50);
    assert.equal(getDeliveryFeeForBarangay("Guintubhan"), 50);
    assert.equal(getDeliveryFeeForBarangay("Camangcamang"), 60);
    assert.equal(getDeliveryFeeForBarangay("Camang2"), 60);
    assert.equal(getDeliveryFeeForBarangay("Tinongan proper"), 60);
    assert.equal(getDeliveryFeeForBarangay("Maytubig"), 60);
    assert.equal(getDeliveryFeeForBarangay("Unknown"), null);
  });

  it("adds a verified delivery fee without changing the item subtotal", () => {
    const getItemPricing = () => ({
      errors: [],
      rows: [],
      orderItems: [],
      total: 499,
    });
    const pricing = getOrderApprovalPricing(
      {
        orderType: "delivery",
        deliveryBarangay: "Rumirang",
        deliveryFee: 50,
      },
      new Map(),
      getItemPricing,
    );
    assert.equal(pricing.itemsSubtotal, 499);
    assert.equal(pricing.deliveryFee, 50);
    assert.equal(pricing.total, 549);

    const invalidPricing = getOrderApprovalPricing(
      {
        orderType: "delivery",
        deliveryBarangay: "Rumirang",
        deliveryFee: 20,
      },
      new Map(),
      getItemPricing,
    );
    assert.equal(invalidPricing.total, null);
    assert.equal(invalidPricing.errors.length, 1);
  });
});
