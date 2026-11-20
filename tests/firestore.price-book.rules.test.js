import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

const projectId = "demo-cactus-cafe-price-book";
const rules = readFileSync(
  new URL("../firestore.rules.prototype.price-book", import.meta.url),
  "utf8",
);
const TEST_ERROR_PATTERN =
  /maximum of 1000 expressions|unable to evaluate the expression|internal error/i;

let testEnv;

function requestFor(items, customerId = "customer-1") {
  return {
    customerId,
    customerEmail: `${customerId}@example.test`,
    customerName: "Cafe Customer",
    phone: "09123456789",
    items,
    orderType: "takeout",
    address: "",
    notes: "No special instructions",
    status: "pending",
    createdAt: Timestamp.now(),
  };
}

function menuItem(priceCents, overrides = {}) {
  return {
    name: "Menu item",
    price: priceCents / 100,
    available: true,
    menuRevision: 1,
    ...overrides,
  };
}

function priceEntry(priceCents, overrides = {}) {
  return {
    priceCents,
    available: true,
    menuRevision: 1,
    ...overrides,
  };
}

function bookData(prices, revision = 1, lastChangedMenuItemId = "coffee") {
  return {
    revision,
    updatedAt: Timestamp.now(),
    lastChangedMenuItemId,
    prices,
  };
}

async function seedPriceBookItems(ids) {
  const prices = {};
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [index, id] of ids.entries()) {
      const cents = 100 + index;
      prices[id] = priceEntry(cents);
      await setDoc(
        doc(db, `menuItems/${id}`),
        menuItem(cents),
      );
    }
    await setDoc(
      doc(db, "menuControl/current"),
      bookData(prices, 1, ids[0] || "coffee"),
    );
  });
  return prices;
}

async function seedPendingRequest(requestId, items) {
  const request = requestFor(items);
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), `orderRequests/${requestId}`),
      request,
    );
  });
  return request;
}

function snapshotsFrom(items, prices) {
  return items.map(({ id, quantity }) => ({
    id,
    quantity,
    priceCents: prices[id].priceCents,
  }));
}

function approvalBatch(db, requestId, request, orderItems) {
  const batch = writeBatch(db);
  batch.update(doc(db, `orderRequests/${requestId}`), {
    status: "approved",
    orderId: requestId,
    reviewedAt: serverTimestamp(),
    reviewedBy: "admin-1",
  });
  batch.set(doc(db, `orders/${requestId}`), {
    requestId,
    customerId: request.customerId,
    items: orderItems,
    status: "Pending",
    createdAt: serverTimestamp(),
  });
  return batch;
}

async function assertDeniedWithoutRuleEvaluationError(operation) {
  let caughtError;
  try {
    await operation;
  } catch (error) {
    caughtError = error;
  }
  assert.ok(caughtError, "Expected Firestore to deny the operation.");
  assert.equal(caughtError.code, "permission-denied");
  assert.doesNotMatch(caughtError.message, TEST_ERROR_PATTERN);
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const now = Timestamp.fromMillis(1);
    await Promise.all([
      setDoc(doc(db, "users/admin-1"), { role: "admin" }),
      setDoc(doc(db, "users/customer-1"), { role: "customer" }),
      setDoc(doc(db, "migrationOperators/admin-1"), { enabled: true }),
      setDoc(doc(db, "menuControl/migration"), {
        state: "ready",
        startedAt: now,
        updatedAt: now,
        updatedBy: "admin-1",
      }),
    ]);
  });
});

describe("price-book/menu synchronization", () => {
  it("supports an atomic initial price-book and menu-item bootstrap", async () => {
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const batch = writeBatch(adminDb);
    batch.set(
      doc(adminDb, "menuItems/coffee"),
      menuItem(425, { menuRevision: 1 }),
    );
    batch.set(doc(adminDb, "menuControl/current"), {
      revision: 1,
      updatedAt: serverTimestamp(),
      lastChangedMenuItemId: "coffee",
      prices: { coffee: priceEntry(425) },
    });

    await assertSucceeds(batch.commit());
    const book = await getDoc(doc(adminDb, "menuControl/current"));
    assert.equal(book.data().prices.coffee.priceCents, 425);
  });

  it("atomically synchronizes menu create, update, and delete", async () => {
    await seedPriceBookItems(["coffee"]);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    const createBatch = writeBatch(adminDb);
    createBatch.set(
      doc(adminDb, "menuItems/tea"),
      menuItem(275, { menuRevision: 1 }),
    );
    createBatch.update(doc(adminDb, "menuControl/current"), {
      revision: 2,
      updatedAt: serverTimestamp(),
      lastChangedMenuItemId: "tea",
      prices: {
        coffee: priceEntry(100),
        tea: priceEntry(275),
      },
    });
    await assertSucceeds(createBatch.commit());

    const updateBatch = writeBatch(adminDb);
    updateBatch.update(doc(adminDb, "menuItems/tea"), {
      price: 325 / 100,
      available: false,
      menuRevision: 2,
    });
    updateBatch.update(doc(adminDb, "menuControl/current"), {
      revision: 3,
      updatedAt: serverTimestamp(),
      lastChangedMenuItemId: "tea",
      prices: {
        coffee: priceEntry(100),
        tea: priceEntry(325, { available: false, menuRevision: 2 }),
      },
    });
    await assertSucceeds(updateBatch.commit());

    const deleteBatch = writeBatch(adminDb);
    deleteBatch.delete(doc(adminDb, "menuItems/tea"));
    deleteBatch.update(doc(adminDb, "menuControl/current"), {
      revision: 4,
      updatedAt: serverTimestamp(),
      lastChangedMenuItemId: "tea",
      prices: { coffee: priceEntry(100) },
    });
    await assertSucceeds(deleteBatch.commit());

    const book = await getDoc(doc(adminDb, "menuControl/current"));
    assert.deepEqual(Object.keys(book.data().prices), ["coffee"]);
    assert.equal((await getDoc(doc(adminDb, "menuItems/tea"))).exists(), false);
  });

  it("rejects a menu-only write", async () => {
    await seedPriceBookItems(["coffee"]);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await assertDeniedWithoutRuleEvaluationError(
      setDoc(
        doc(adminDb, "menuItems/tea"),
        menuItem(275),
      ),
    );
  });

  it("rejects a price-book-only write", async () => {
    await seedPriceBookItems(["coffee"]);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await assertDeniedWithoutRuleEvaluationError(
      updateDoc(doc(adminDb, "menuControl/current"), {
        revision: 2,
        updatedAt: serverTimestamp(),
        lastChangedMenuItemId: "coffee",
        prices: { coffee: priceEntry(150, { menuRevision: 2 }) },
      }),
    );
  });

  it("rejects changing an unrelated price-book entry in a paired write", async () => {
    await seedPriceBookItems(["coffee", "tea"]);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const batch = writeBatch(adminDb);
    batch.update(doc(adminDb, "menuItems/coffee"), {
      price: 1.5,
      menuRevision: 2,
    });
    batch.update(doc(adminDb, "menuControl/current"), {
      revision: 2,
      updatedAt: serverTimestamp(),
      lastChangedMenuItemId: "coffee",
      prices: {
        coffee: priceEntry(150, { menuRevision: 2 }),
        tea: priceEntry(999, { menuRevision: 2 }),
      },
    });
    await assertDeniedWithoutRuleEvaluationError(batch.commit());
  });

  it("rejects menu writes by a customer", async () => {
    await seedPriceBookItems(["coffee"]);
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    await assertDeniedWithoutRuleEvaluationError(
      setDoc(doc(customerDb, "menuItems/tea"), menuItem(275)),
    );
  });
});

describe("price-book order approval", () => {
  for (const itemCount of [1, 2, 5, 10]) {
    it(`approves an order with ${itemCount} distinct item line(s)`, async () => {
      const ids = Array.from({ length: itemCount }, (_, index) => `menu-${index}`);
      const requestItems = ids.map((id, index) => ({
        id,
        quantity: index + 1,
      }));
      const prices = await seedPriceBookItems(ids);
      const requestId = `approval-${itemCount}`;
      const request = await seedPendingRequest(requestId, requestItems);
      const adminDb = testEnv.authenticatedContext("admin-1").firestore();

      await assertSucceeds(
        approvalBatch(
          adminDb,
          requestId,
          request,
          snapshotsFrom(requestItems, prices),
        ).commit(),
      );

      const order = await getDoc(doc(adminDb, `orders/${requestId}`));
      assert.deepEqual(order.data().items, snapshotsFrom(requestItems, prices));
    });
  }

  it("rejects a forged price snapshot", async () => {
    const items = [{ id: "coffee", quantity: 2 }];
    const prices = await seedPriceBookItems(["coffee"]);
    const requestId = "forged-price";
    const request = await seedPendingRequest(requestId, items);
    const forged = [{ id: "coffee", quantity: 2, priceCents: 1 }];
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await assertDeniedWithoutRuleEvaluationError(
      approvalBatch(adminDb, requestId, request, forged).commit(),
    );
    assert.equal(prices.coffee.priceCents, 100);
  });

  it("rejects approval of a legacy request with duplicate item IDs", async () => {
    const items = [
      { id: "coffee", quantity: 1 },
      { id: "coffee", quantity: 2 },
    ];
    const prices = await seedPriceBookItems(["coffee"]);
    const requestId = "duplicate-request-items";
    const request = await seedPendingRequest(requestId, items);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertDeniedWithoutRuleEvaluationError(
      approvalBatch(
        adminDb,
        requestId,
        request,
        snapshotsFrom(items, prices),
      ).commit(),
    );
    assert.equal(
      (await getDoc(doc(adminDb, `orderRequests/${requestId}`))).data().status,
      "pending",
    );
    assert.equal(
      (await getDoc(doc(adminDb, `orders/${requestId}`))).exists(),
      false,
    );
  });

  it("rejects a request item missing from the price book", async () => {
    await seedPriceBookItems(["coffee"]);
    const items = [{ id: "missing-item", quantity: 1 }];
    const requestId = "missing-price-entry";
    const request = await seedPendingRequest(requestId, items);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await assertDeniedWithoutRuleEvaluationError(
      approvalBatch(
        adminDb,
        requestId,
        request,
        [{ id: "missing-item", quantity: 1, priceCents: 0 }],
      ).commit(),
    );
  });

  it("rejects an unavailable item", async () => {
    await seedPriceBookItems(["coffee"]);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await updateDoc(doc(db, "menuItems/coffee"), {
        available: false,
        menuRevision: 2,
      });
      await updateDoc(doc(db, "menuControl/current"), {
        prices: {
          coffee: priceEntry(100, { available: false, menuRevision: 2 }),
        },
      });
    });
    const items = [{ id: "coffee", quantity: 1 }];
    const requestId = "unavailable-item";
    const request = await seedPendingRequest(requestId, items);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await assertDeniedWithoutRuleEvaluationError(
      approvalBatch(
        adminDb,
        requestId,
        request,
        [{ id: "coffee", quantity: 1, priceCents: 100 }],
      ).commit(),
    );
  });

  it("rejects an order quantity that differs from the request", async () => {
    const items = [{ id: "coffee", quantity: 2 }];
    const prices = await seedPriceBookItems(["coffee"]);
    const requestId = "quantity-mismatch";
    const request = await seedPendingRequest(requestId, items);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await assertDeniedWithoutRuleEvaluationError(
      approvalBatch(
        adminDb,
        requestId,
        request,
        [{ id: "coffee", quantity: 1, priceCents: prices.coffee.priceCents }],
      ).commit(),
    );
  });

  it("rejects a duplicate approval", async () => {
    const items = [{ id: "coffee", quantity: 1 }];
    const prices = await seedPriceBookItems(["coffee"]);
    const requestId = "duplicate-approval";
    const request = await seedPendingRequest(requestId, items);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const batch = approvalBatch(
      adminDb,
      requestId,
      request,
      snapshotsFrom(items, prices),
    );
    await assertSucceeds(batch.commit());
    await assertDeniedWithoutRuleEvaluationError(
      approvalBatch(
        adminDb,
        requestId,
        request,
        snapshotsFrom(items, prices),
      ).commit(),
    );
  });

  it("rejects customer approval and customer-created orders", async () => {
    const items = [{ id: "coffee", quantity: 1 }];
    const prices = await seedPriceBookItems(["coffee"]);
    const requestId = "customer-approval";
    const request = await seedPendingRequest(requestId, items);
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    await assertDeniedWithoutRuleEvaluationError(
      approvalBatch(
        customerDb,
        requestId,
        request,
        snapshotsFrom(items, prices),
      ).commit(),
    );
    await assertDeniedWithoutRuleEvaluationError(
      setDoc(doc(customerDb, "orders/customer-order"), {
        requestId: "customer-order",
        customerId: "customer-1",
        items: [{ id: "coffee", quantity: 1, priceCents: 100 }],
        status: "Pending",
        createdAt: serverTimestamp(),
      }),
    );
  });
});
