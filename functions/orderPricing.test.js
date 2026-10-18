import assert from "node:assert/strict";
import test from "node:test";
import { priceMenuItems } from "./orderPricing.js";

const snapshot = (id, data, exists = true) => ({
  id,
  exists,
  data: () => data,
});

test("prices order lines from current menu documents", () => {
  const result = priceMenuItems(
    [
      { id: "latte", quantity: 2 },
      { id: "cake", quantity: 1 },
    ],
    [
      snapshot("latte", { name: "Latte", price: 125.5 }),
      snapshot("cake", { name: "Cake", price: 80, available: true }),
    ]
  );

  assert.deepEqual(result, {
    items: [
      {
        id: "latte",
        name: "Latte",
        price: 125.5,
        quantity: 2,
        subtotal: 251,
      },
      {
        id: "cake",
        name: "Cake",
        price: 80,
        quantity: 1,
        subtotal: 80,
      },
    ],
    total: 331,
  });
});

test("rejects a missing or explicitly unavailable menu item", () => {
  assert.throws(
    () =>
      priceMenuItems(
        [{ id: "missing", quantity: 1 }],
        [snapshot("missing", {}, false)]
      ),
    { code: "failed-precondition" }
  );

  assert.throws(
    () =>
      priceMenuItems(
        [{ id: "latte", quantity: 1 }],
        [snapshot("latte", { name: "Latte", price: 125, available: false })]
      ),
    { code: "failed-precondition" }
  );
});

test("rejects invalid menu prices", () => {
  assert.throws(
    () =>
      priceMenuItems(
        [{ id: "latte", quantity: 1 }],
        [snapshot("latte", { name: "Latte", price: Number.NaN })]
      ),
    { code: "failed-precondition" }
  );
});
