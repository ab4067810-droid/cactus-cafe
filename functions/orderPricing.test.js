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

test("rejects negative, non-finite, and non-numeric menu prices", () => {
  for (const price of [-1, Number.POSITIVE_INFINITY, "1.25"]) {
    assert.throws(
      () =>
        priceMenuItems(
          [{ id: "latte", quantity: 1 }],
          [snapshot("latte", { name: "Latte", price })]
        ),
      { code: "failed-precondition" }
    );
  }
});

for (const [description, quantity] of [
  ["zero", 0],
  ["negative", -1],
  ["fractional", 1.5],
  ["non-numeric", "2"],
]) {
  test(`rejects ${description} quantities`, () => {
    assert.throws(
      () =>
        priceMenuItems(
          [{ id: "latte", quantity }],
          [snapshot("latte", { name: "Latte", price: 2 })]
        ),
      { code: "invalid-argument" }
    );
  });
}

test("rounds menu prices to the nearest cent", () => {
  const result = priceMenuItems(
    [
      { id: "down", quantity: 1 },
      { id: "up", quantity: 1 },
      { id: "decimal-edge", quantity: 1 },
    ],
    [
      snapshot("down", { name: "Down", price: 1.234 }),
      snapshot("up", { name: "Up", price: 1.235 }),
      snapshot("decimal-edge", { name: "Decimal edge", price: 1.005 }),
    ]
  );

  assert.deepEqual(
    result.items.map(({ price, subtotal }) => ({ price, subtotal })),
    [
      { price: 1.23, subtotal: 1.23 },
      { price: 1.24, subtotal: 1.24 },
      { price: 1.01, subtotal: 1.01 },
    ]
  );
  assert.equal(result.total, 3.48);
});

test("rejects unsafe subtotal calculations", () => {
  assert.throws(
    () =>
      priceMenuItems(
        [{ id: "latte", quantity: Number.MAX_SAFE_INTEGER }],
        [snapshot("latte", { name: "Latte", price: 0.02 })]
      ),
    { code: "invalid-argument" }
  );
});

test("rejects unsafe order-total calculations", () => {
  const itemPrice = 45035996273704.96;

  assert.throws(
    () =>
      priceMenuItems(
        [
          { id: "first", quantity: 1 },
          { id: "second", quantity: 1 },
        ],
        [
          snapshot("first", { name: "First", price: itemPrice }),
          snapshot("second", { name: "Second", price: itemPrice }),
        ]
      ),
    { code: "invalid-argument" }
  );
});
