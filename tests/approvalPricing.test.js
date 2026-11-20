import assert from "node:assert/strict";
import test from "node:test";
import { getApprovalPricing } from "../src/utils/approvalPricing.js";

test("rejects a requested menu item that no longer exists", () => {
  const pricing = getApprovalPricing(
    { items: [{ id: "missing", quantity: 1 }] },
    new Map()
  );

  assert.deepEqual(pricing.errors, [
    'Menu item "missing" no longer exists.',
  ]);
  assert.equal(pricing.total, null);
});

test("rejects a requested menu item that is unavailable", () => {
  const pricing = getApprovalPricing(
    { items: [{ id: "coffee", quantity: 1 }] },
    new Map([
      ["coffee", { name: "Coffee", price: 4, available: false }],
    ])
  );

  assert.deepEqual(pricing.errors, [
    'Menu item "Coffee" is unavailable.',
  ]);
});

test("prices sized request lines from the price book and labels the order item", () => {
  const request = {
    items: [{ id: "milk-tea", quantity: 2, size: "12oz" }],
  };
  const pricing = getApprovalPricing(
    request,
    new Map([
      ["milk-tea", {
        name: "Milk Tea",
        price: 5,
        available: true,
        sizes: { "8oz": 5, "12oz": 7, "16oz": 9 },
        sizePricesCents: { "8oz": 500, "12oz": 725, "16oz": 900 },
      }],
    ]),
  );

  assert.deepEqual(pricing.errors, []);
  assert.equal(pricing.total, 14.5);
  assert.deepEqual(pricing.orderItems, [{
    id: "milk-tea",
    name: "Milk Tea (12oz)",
    price: 7.25,
    quantity: 2,
    subtotal: 14.5,
    size: "12oz",
  }]);
});

test("falls back to the menu size price when the price book has no size price", () => {
  const pricing = getApprovalPricing(
    { items: [{ id: "soda", quantity: 1, size: "16oz" }] },
    new Map([
      ["soda", {
        name: "Soda",
        price: 3,
        available: true,
        sizes: { "8oz": 3, "12oz": 4, "16oz": 5.5 },
      }],
    ]),
  );

  assert.deepEqual(pricing.errors, []);
  assert.equal(pricing.orderItems[0].price, 5.5);
  assert.equal(pricing.orderItems[0].size, "16oz");
  assert.equal(pricing.orderItems[0].name, "Soda (16oz)");
});
