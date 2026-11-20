import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";

const projectId = "demo-cactus-cafe-request-snapshot";
const RULE_EVALUATION_ERROR =
  /maximum of 1000 expressions|maximum.*access calls|unable to evaluate the expression|internal error/i;
const rules = readFileSync(
  new URL("../firestore.rules.prototype.request-snapshot", import.meta.url),
  "utf8",
);

let testEnv;

async function assertFails(operation) {
  let error;
  try {
    await operation;
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "Expected Firestore to deny the operation.");
  assert.equal(error.code, "permission-denied");
  assert.doesNotMatch(error.message, RULE_EVALUATION_ERROR);
}

function priceEntry(priceCents, overrides = {}) {
  return {
    name: "Menu item",
    priceCents,
    available: true,
    menuRevision: 1,
    ...overrides,
  };
}

function snapshotFor(id, quantity, entry) {
  const subtotalCents = entry.priceCents * quantity;
  return {
    id,
    name: entry.name,
    quantity,
    priceCents: entry.priceCents,
    price: entry.priceCents / 100,
    subtotal: subtotalCents / 100,
  };
}

function requestFor(items, overrides = {}) {
  const totalCents = items.reduce(
    (total, item) => total + item.priceCents * item.quantity,
    0,
  );
  return {
    customerId: "customer-1",
    customerName: "Cafe Customer",
    customerEmail: "customer@example.test",
    phone: "09123456789",
    orderType: "takeout",
    address: "",
    notes: "No special instructions",
    items,
    totalCents,
    total: totalCents / 100,
    snapshotVersion: 1,
    status: "pending",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedPriceBook(ids, centsById = {}, overridesById = {}) {
  const prices = {};
  for (const [index, id] of ids.entries()) {
    const cents = centsById[id] ?? 100 + index;
    prices[id] = priceEntry(cents, overridesById[id]);
  }
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "menuControl/current"), { prices });
  });
  return prices;
}

async function submitRequest(db, requestId, request) {
  await setDoc(doc(db, `orderRequests/${requestId}`), request);
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "users/customer-1"), { role: "customer" }),
      setDoc(doc(db, "users/customer-2"), { role: "customer" }),
      setDoc(doc(db, "users/admin-1"), { role: "admin" }),
      setDoc(doc(db, "menuControl/migration"), { state: "ready" }),
      setDoc(doc(db, "menuControl/current"), { prices: {} }),
    ]);
  });
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

describe("customer-submitted price-book snapshots", () => {
  for (const itemCount of [1, 2, 5, 10]) {
    it(`accepts a valid request with ${itemCount} item(s)`, async () => {
      const ids = Array.from({ length: itemCount }, (_, index) => `menu-${index}`);
      const prices = await seedPriceBook(ids);
      const items = ids.map((id, index) =>
        snapshotFor(id, index + 1, prices[id]),
      );
      const db = testEnv.authenticatedContext("customer-1").firestore();

      await assertSucceeds(
        submitRequest(db, `valid-${itemCount}`, requestFor(items)),
      );
    });
  }

  it("rejects a request with 11 items", async () => {
    const ids = Array.from({ length: 11 }, (_, index) => `menu-${index}`);
    const prices = await seedPriceBook(ids);
    const items = ids.map((id) => snapshotFor(id, 1, prices[id]));
    const db = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(
      submitRequest(db, "too-many-items", requestFor(items)),
    );
  });

  it("rejects missing and extra request or item fields", async () => {
    const prices = await seedPriceBook(["coffee"]);
    const item = snapshotFor("coffee", 1, prices.coffee);
    const db = testEnv.authenticatedContext("customer-1").firestore();
    const missingRequestField = requestFor([item]);
    delete missingRequestField.snapshotVersion;

    await assertFails(
      submitRequest(db, "missing-request-field", missingRequestField),
    );
    await assertFails(
      submitRequest(
        db,
        "extra-request-field",
        requestFor([item], { unexpected: true }),
      ),
    );
    await assertFails(
      submitRequest(
        db,
        "missing-item-field",
        requestFor([{ id: item.id, quantity: item.quantity }]),
      ),
    );
    await assertFails(
      submitRequest(
        db,
        "extra-item-field",
        requestFor([{ ...item, unexpected: true }]),
      ),
    );
  });

  it("rejects a forged item name", async () => {
    const prices = await seedPriceBook(["coffee"]);
    const item = snapshotFor("coffee", 1, prices.coffee);
    const db = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(
      submitRequest(
        db,
        "forged-name",
        requestFor([{ ...item, name: "Forged menu item" }]),
      ),
    );
  });

  it("rejects forged item price and priceCents values", async () => {
    const prices = await seedPriceBook(["coffee"]);
    const item = snapshotFor("coffee", 2, prices.coffee);
    const db = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(
      submitRequest(
        db,
        "forged-price",
        requestFor([{ ...item, price: 99 }]),
      ),
    );
    await assertFails(
      submitRequest(
        db,
        "forged-price-cents",
        requestFor([
          {
            ...item,
            priceCents: item.priceCents + 1,
            price: (item.priceCents + 1) / 100,
            subtotal: (item.priceCents + 1) * item.quantity / 100,
          },
        ]),
      ),
    );
  });

  it("rejects unavailable and missing price-book items", async () => {
    const prices = await seedPriceBook(
      ["unavailable"],
      {},
      { unavailable: { available: false } },
    );
    const db = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(
      submitRequest(
        db,
        "unavailable-item",
        requestFor([snapshotFor("unavailable", 1, prices.unavailable)]),
      ),
    );
    await assertFails(
      submitRequest(
        db,
        "missing-item",
        requestFor([
          snapshotFor("not-in-price-book", 1, priceEntry(100)),
        ]),
      ),
    );
  });

  it("rejects duplicate item IDs", async () => {
    const prices = await seedPriceBook(["coffee"]);
    const item = snapshotFor("coffee", 1, prices.coffee);
    const db = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(
      submitRequest(db, "duplicate-ids", requestFor([item, item])),
    );
  });

  it("rejects quantities outside 1 through 99 or that are not integers", async () => {
    const prices = await seedPriceBook(["coffee"]);
    const item = snapshotFor("coffee", 1, prices.coffee);
    const db = testEnv.authenticatedContext("customer-1").firestore();

    for (const [requestId, quantity] of [
      ["quantity-zero", 0],
      ["quantity-fraction", 1.5],
      ["quantity-too-large", 100],
    ]) {
      const invalidItem = {
        ...item,
        quantity,
        subtotal: item.priceCents * quantity / 100,
      };
      await assertFails(
        submitRequest(db, requestId, requestFor([invalidItem])),
      );
    }
  });

  it("rejects incorrect item subtotals and request totals", async () => {
    const prices = await seedPriceBook(["coffee"]);
    const item = snapshotFor("coffee", 2, prices.coffee);
    const db = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(
      submitRequest(
        db,
        "incorrect-subtotal",
        requestFor([{ ...item, subtotal: item.subtotal + 1 }]),
      ),
    );
    await assertFails(
      submitRequest(
        db,
        "incorrect-total-cents",
        requestFor([item], { totalCents: item.priceCents }),
      ),
    );
    await assertFails(
      submitRequest(
        db,
        "incorrect-total",
        requestFor([item], { total: 999 }),
      ),
    );
  });

  it("accepts fractional prices of 1005 and 1015 cents", async () => {
    const centsById = { coffee: 1005, tea: 1015 };
    const prices = await seedPriceBook(
      Object.keys(centsById),
      centsById,
    );
    const db = testEnv.authenticatedContext("customer-1").firestore();

    for (const [id, cents] of Object.entries(centsById)) {
      const item = snapshotFor(id, 1, prices[id]);
      await assertSucceeds(
        submitRequest(
          db,
          `fractional-${cents}`,
          requestFor([item]),
        ),
      );
    }
  });

  it("accepts a combined fractional-price request totaling 2020 cents", async () => {
    const centsById = { coffee: 1005, tea: 1015 };
    const prices = await seedPriceBook(
      Object.keys(centsById),
      centsById,
    );
    const items = Object.keys(centsById).map((id) =>
      snapshotFor(id, 1, prices[id]),
    );
    const db = testEnv.authenticatedContext("customer-1").firestore();

    await assertSucceeds(
      submitRequest(db, "combined-fractional", requestFor(items)),
    );
  });

  it("rejects unauthenticated and cross-customer submissions", async () => {
    const prices = await seedPriceBook(["coffee"]);
    const item = snapshotFor("coffee", 1, prices.coffee);
    const anonymousDb = testEnv.unauthenticatedContext().firestore();
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(
      submitRequest(anonymousDb, "unauthenticated", requestFor([item])),
    );
    await assertFails(
      submitRequest(
        customerDb,
        "cross-customer",
        requestFor([item], { customerId: "customer-2" }),
      ),
    );
  });

  it("does not allow administrators to create customer snapshots", async () => {
    const prices = await seedPriceBook(["coffee"]);
    const item = snapshotFor("coffee", 1, prices.coffee);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertFails(
      submitRequest(adminDb, "admin-submission", requestFor([item])),
    );
  });

  it("rejects customer modification and deletion after submission", async () => {
    const prices = await seedPriceBook(["coffee"]);
    const item = snapshotFor("coffee", 1, prices.coffee);
    const db = testEnv.authenticatedContext("customer-1").firestore();
    await assertSucceeds(
      submitRequest(db, "immutable-snapshot", requestFor([item])),
    );

    await assertFails(
      updateDoc(doc(db, "orderRequests/immutable-snapshot"), {
        notes: "Changed after submission",
      }),
    );
    await assertFails(
      deleteDoc(doc(db, "orderRequests/immutable-snapshot")),
    );
  });

  it("rejects submissions unless migration state is ready", async () => {
    const prices = await seedPriceBook(["coffee"]);
    const item = snapshotFor("coffee", 1, prices.coffee);
    const db = testEnv.authenticatedContext("customer-1").firestore();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "menuControl/migration"), {
        state: "migrating",
      });
    });

    await assertFails(
      submitRequest(db, "migration-not-ready", requestFor([item])),
    );
  });
});
