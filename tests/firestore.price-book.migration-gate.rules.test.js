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

const projectId = "demo-cactus-cafe-price-book-migration-gate";
const rules = readFileSync(
  new URL("../firestore.rules.prototype.price-book.migration-gate", import.meta.url),
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

async function seedPriceBookItems(ids, priceCentsById = {}) {
  const prices = {};
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [index, id] of ids.entries()) {
      const cents = priceCentsById[id] ?? 100 + index;
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
    name: "Menu item",
    price: prices[id].priceCents / 100,
    quantity,
    priceCents: prices[id].priceCents,
    subtotal: (prices[id].priceCents * quantity) / 100,
  }));
}

function approvalBatch(db, requestId, request, orderItems, orderOverrides = {}) {
  const totalCents = orderItems.reduce(
    (total, item) => total + item.priceCents * item.quantity,
    0,
  );
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
    customerName: request.customerName,
    customerEmail: request.customerEmail,
    phone: request.phone,
    orderType: request.orderType,
    address: request.address,
    notes: request.notes,
    items: orderItems,
    total: totalCents / 100,
    status: "Pending",
    createdAt: serverTimestamp(),
    ...orderOverrides,
  });
  return batch;
}

async function setMigrationState(db, state, updatedBy = "admin-1") {
  await updateDoc(doc(db, "menuControl/migration"), {
    state,
    updatedAt: serverTimestamp(),
    updatedBy,
  });
}

async function transitionToReady(db) {
  await setMigrationState(db, "finalizing");
  await setMigrationState(db, "ready");
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
      setDoc(doc(db, "users/admin-2"), { role: "admin" }),
      setDoc(doc(db, "users/customer-1"), { role: "customer" }),
      setDoc(doc(db, "migrationOperators/admin-1"), { enabled: true }),
      setDoc(doc(db, "menuControl/migration"), {
        state: "migrating",
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

describe("price-book migration state", () => {
  it("allows only the protected operator to initialize migration", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("menuControl/migration").delete();
    });
    const operatorDb = testEnv.authenticatedContext("admin-1").firestore();
    const ordinaryAdminDb = testEnv.authenticatedContext("admin-2").firestore();
    const initialState = {
      state: "migrating",
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: "admin-1",
    };

    await assertDeniedWithoutRuleEvaluationError(
      setDoc(doc(ordinaryAdminDb, "menuControl/migration"), {
        ...initialState,
        updatedBy: "admin-2",
      }),
    );
    await assertSucceeds(
      setDoc(doc(operatorDb, "menuControl/migration"), initialState),
    );
  });

  it("allows only the protected operator to complete the ordered state transitions", async () => {
    const operatorDb = testEnv.authenticatedContext("admin-1").firestore();
    const ordinaryAdminDb = testEnv.authenticatedContext("admin-2").firestore();

    await assertDeniedWithoutRuleEvaluationError(
      setMigrationState(ordinaryAdminDb, "finalizing", "admin-2"),
    );
    await assertDeniedWithoutRuleEvaluationError(
      setMigrationState(operatorDb, "ready"),
    );

    await setMigrationState(operatorDb, "finalizing");
    await setMigrationState(operatorDb, "ready");
    await assertDeniedWithoutRuleEvaluationError(
      setMigrationState(operatorDb, "migrating"),
    );
    assert.equal(
      (await getDoc(doc(operatorDb, "menuControl/migration"))).data().state,
      "ready",
    );
  });

  it("denies an ordinary admin from transitioning finalizing to ready", async () => {
    const operatorDb = testEnv.authenticatedContext("admin-1").firestore();
    const ordinaryAdminDb = testEnv.authenticatedContext("admin-2").firestore();
    await setMigrationState(operatorDb, "finalizing");

    await assertDeniedWithoutRuleEvaluationError(
      setMigrationState(ordinaryAdminDb, "ready", "admin-2"),
    );
    assert.equal(
      (await getDoc(doc(operatorDb, "menuControl/migration"))).data().state,
      "finalizing",
    );
  });

  it("denies a ready-to-finalizing transition", async () => {
    const operatorDb = testEnv.authenticatedContext("admin-1").firestore();
    await transitionToReady(operatorDb);

    await assertDeniedWithoutRuleEvaluationError(
      setMigrationState(operatorDb, "finalizing"),
    );
    assert.equal(
      (await getDoc(doc(operatorDb, "menuControl/migration"))).data().state,
      "ready",
    );
  });

  it("prevents client-side creation or modification of operator grants", async () => {
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const newGrantDb = testEnv.authenticatedContext("admin-2").firestore();
    await assertDeniedWithoutRuleEvaluationError(
      updateDoc(doc(adminDb, "migrationOperators/admin-1"), {
        enabled: false,
      }),
    );
    await assertDeniedWithoutRuleEvaluationError(
      setDoc(doc(newGrantDb, "migrationOperators/admin-2"), {
        enabled: true,
      }),
    );
    await assertDeniedWithoutRuleEvaluationError(
      testEnv.authenticatedContext("admin-1")
        .firestore()
        .doc("migrationOperators/admin-1")
        .delete(),
    );
  });

  it("backfills a legacy menu item only with its matching price-book entry while migrating", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "menuItems/legacy-coffee"), {
        name: "Legacy coffee",
        price: 1,
        available: true,
      });
      await setDoc(doc(db, "menuItems/tea"), menuItem(200));
      await setDoc(
        doc(db, "menuControl/current"),
        bookData({ tea: priceEntry(200) }, 1, "tea"),
      );
    });

    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const backfillBatch = writeBatch(adminDb);
    backfillBatch.update(doc(adminDb, "menuItems/legacy-coffee"), {
      menuRevision: 1,
    });
    backfillBatch.update(doc(adminDb, "menuControl/current"), {
      revision: 2,
      updatedAt: serverTimestamp(),
      lastChangedMenuItemId: "legacy-coffee",
      prices: {
        tea: priceEntry(200),
        "legacy-coffee": priceEntry(100),
      },
    });
    await assertSucceeds(backfillBatch.commit());

    const menu = await getDoc(doc(adminDb, "menuItems/legacy-coffee"));
    const book = await getDoc(doc(adminDb, "menuControl/current"));
    assert.equal(menu.data().menuRevision, 1);
    assert.equal(book.data().prices["legacy-coffee"].priceCents, 100);
  });

  it("can bootstrap the initial price book with a paired legacy backfill", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "menuItems/legacy-coffee"), {
        name: "Legacy coffee",
        price: 1,
        available: true,
      });
    });

    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const backfillBatch = writeBatch(adminDb);
    backfillBatch.update(doc(adminDb, "menuItems/legacy-coffee"), {
      menuRevision: 1,
    });
    backfillBatch.set(doc(adminDb, "menuControl/current"), {
      revision: 1,
      updatedAt: serverTimestamp(),
      lastChangedMenuItemId: "legacy-coffee",
      prices: { "legacy-coffee": priceEntry(100) },
    });
    await assertSucceeds(backfillBatch.commit());
  });

  it("rejects initial price-book creation without a paired menu change", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "menuItems/coffee"),
        menuItem(100),
      );
    });

    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await assertDeniedWithoutRuleEvaluationError(
      setDoc(doc(adminDb, "menuControl/current"), {
        revision: 1,
        updatedAt: serverTimestamp(),
        lastChangedMenuItemId: "coffee",
        prices: { coffee: priceEntry(100) },
      }),
    );
  });

  it("freezes standalone and paired menu/price-book writes during finalizing", async () => {
    await seedPriceBookItems(["coffee"]);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await setMigrationState(adminDb, "finalizing");

    await assertDeniedWithoutRuleEvaluationError(
      updateDoc(doc(adminDb, "menuItems/coffee"), {
        price: 1.5,
        menuRevision: 2,
      }),
    );
    await assertDeniedWithoutRuleEvaluationError(
      updateDoc(doc(adminDb, "menuControl/current"), {
        revision: 2,
        updatedAt: serverTimestamp(),
        lastChangedMenuItemId: "coffee",
        prices: { coffee: priceEntry(150, { menuRevision: 2 }) },
      }),
    );

    const pairedBatch = writeBatch(adminDb);
    pairedBatch.update(doc(adminDb, "menuItems/coffee"), {
      price: 1.5,
      menuRevision: 2,
    });
    pairedBatch.update(doc(adminDb, "menuControl/current"), {
      revision: 2,
      updatedAt: serverTimestamp(),
      lastChangedMenuItemId: "coffee",
      prices: { coffee: priceEntry(150, { menuRevision: 2 }) },
    });
    await assertDeniedWithoutRuleEvaluationError(pairedBatch.commit());
  });

  it("preserves paired menu updates after readiness", async () => {
    await seedPriceBookItems(["coffee"]);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await transitionToReady(adminDb);
    const batch = writeBatch(adminDb);
    batch.update(doc(adminDb, "menuItems/coffee"), {
      price: 1.5,
      menuRevision: 2,
    });
    batch.update(doc(adminDb, "menuControl/current"), {
      revision: 2,
      updatedAt: serverTimestamp(),
      lastChangedMenuItemId: "coffee",
      prices: { coffee: priceEntry(150, { menuRevision: 2 }) },
    });
    await assertSucceeds(batch.commit());
  });
});

describe("price-book order approval", () => {
  it("rejects approval while migrating or finalizing", async () => {
    const items = [{ id: "coffee", quantity: 1 }];
    const prices = await seedPriceBookItems(["coffee"]);
    const requestId = "approval-not-ready";
    const request = await seedPendingRequest(requestId, items);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    for (const state of ["migrating", "finalizing"]) {
      if (state === "finalizing") {
        await setMigrationState(adminDb, "finalizing");
      }
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
    }
  });

  for (const itemCount of [1, 2, 5, 10]) {
    it(`approves a rich order with ${itemCount} distinct item line(s)`, async () => {
      const ids = Array.from({ length: itemCount }, (_, index) => `menu-${index}`);
      const requestItems = ids.map((id, index) => ({
        id,
        quantity: index + 1,
      }));
      const prices = await seedPriceBookItems(ids);
      const requestId = `approval-${itemCount}`;
      const request = await seedPendingRequest(requestId, requestItems);
      const adminDb = testEnv.authenticatedContext("admin-1").firestore();
      await transitionToReady(adminDb);

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
      assert.equal(order.data().requestId, requestId);
      assert.equal(order.data().customerId, request.customerId);
      assert.equal(order.data().customerName, request.customerName);
      assert.equal(order.data().customerEmail, request.customerEmail);
      assert.equal(order.data().phone, request.phone);
      assert.equal(order.data().orderType, request.orderType);
      assert.equal(order.data().address, request.address);
      assert.equal(order.data().notes, request.notes);
      assert.equal(
        order.data().total,
        requestItems.reduce(
          (total, item) => total + prices[item.id].priceCents * item.quantity,
          0,
        ) / 100,
      );
      assert.equal(order.data().status, "Pending");
      assert.ok(order.data().createdAt instanceof Timestamp);
    });
  }

  it("approves fractional peso totals of 10.05 and 10.15", async () => {
    const itemCents = {
      "coffee-1005": 1005,
      "coffee-1015": 1015,
    };
    const ids = Object.keys(itemCents);
    const prices = await seedPriceBookItems(ids, itemCents);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await transitionToReady(adminDb);

    for (const [id, expectedCents] of Object.entries(itemCents)) {
      const items = [{ id, quantity: 1 }];
      const requestId = `fractional-total-${expectedCents}`;
      const request = await seedPendingRequest(requestId, items);
      await assertSucceeds(
        approvalBatch(
          adminDb,
          requestId,
          request,
          snapshotsFrom(items, prices),
        ).commit(),
      );

      const order = await getDoc(doc(adminDb, `orders/${requestId}`));
      assert.equal(order.data().items[0].price, expectedCents / 100);
      assert.equal(order.data().items[0].subtotal, expectedCents / 100);
      assert.equal(order.data().total, expectedCents / 100);
    }
  });

  it("approves a combined fractional-price order totaling 20.20", async () => {
    const itemCents = {
      "coffee-1005": 1005,
      "coffee-1015": 1015,
    };
    const items = Object.keys(itemCents).map((id) => ({
      id,
      quantity: 1,
    }));
    const prices = await seedPriceBookItems(Object.keys(itemCents), itemCents);
    const requestId = "combined-fractional-order";
    const request = await seedPendingRequest(requestId, items);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await transitionToReady(adminDb);

    await assertSucceeds(
      approvalBatch(
        adminDb,
        requestId,
        request,
        snapshotsFrom(items, prices),
      ).commit(),
    );

    const order = await getDoc(doc(adminDb, `orders/${requestId}`));
    assert.deepEqual(
      order.data().items.map(({ price, subtotal }) => ({ price, subtotal })),
      [
        { price: 10.05, subtotal: 10.05 },
        { price: 10.15, subtotal: 10.15 },
      ],
    );
    assert.equal(order.data().total, 20.20);
  });

  it("rejects forged item prices and price cents", async () => {
    const items = [{ id: "coffee", quantity: 2 }];
    const prices = await seedPriceBookItems(["coffee"]);
    const requestId = "forged-price";
    const request = await seedPendingRequest(requestId, items);
    const validSnapshot = snapshotsFrom(items, prices)[0];
    const forgedPrices = [{ ...validSnapshot, price: 99 }];
    const forgedPriceCents = [{
      ...validSnapshot,
      price: 0.01,
      priceCents: 1,
      subtotal: 0.02,
    }];
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await transitionToReady(adminDb);
    await assertDeniedWithoutRuleEvaluationError(
      approvalBatch(adminDb, requestId, request, forgedPrices).commit(),
    );
    await assertDeniedWithoutRuleEvaluationError(
      approvalBatch(
        adminDb,
        requestId,
        request,
        forgedPriceCents,
      ).commit(),
    );
    assert.equal(prices.coffee.priceCents, 100);
  });

  it("rejects an incorrect item subtotal", async () => {
    const items = [{ id: "coffee", quantity: 2 }];
    const prices = await seedPriceBookItems(["coffee"]);
    const requestId = "incorrect-item-subtotal";
    const request = await seedPendingRequest(requestId, items);
    const forgedItems = snapshotsFrom(items, prices).map((item) => ({
      ...item,
      subtotal: item.subtotal + 1,
    }));
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await transitionToReady(adminDb);

    await assertDeniedWithoutRuleEvaluationError(
      approvalBatch(adminDb, requestId, request, forgedItems).commit(),
    );
  });

  it("rejects an incorrect order total", async () => {
    const items = [{ id: "coffee", quantity: 2 }];
    const prices = await seedPriceBookItems(["coffee"]);
    const requestId = "incorrect-order-total";
    const request = await seedPendingRequest(requestId, items);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await transitionToReady(adminDb);

    await assertDeniedWithoutRuleEvaluationError(
      approvalBatch(
        adminDb,
        requestId,
        request,
        snapshotsFrom(items, prices),
        { total: 999 },
      ).commit(),
    );
  });

  it("rejects customer details that differ from the original request", async () => {
    const items = [{ id: "coffee", quantity: 1 }];
    const prices = await seedPriceBookItems(["coffee"]);
    const requestId = "forged-order-customer-details";
    const request = await seedPendingRequest(requestId, items);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await transitionToReady(adminDb);

    await assertDeniedWithoutRuleEvaluationError(
      approvalBatch(
        adminDb,
        requestId,
        request,
        snapshotsFrom(items, prices),
        { customerName: "Different Customer" },
      ).commit(),
    );
  });

  it("rejects a customer email that differs from the original request", async () => {
    const items = [{ id: "coffee", quantity: 1 }];
    const prices = await seedPriceBookItems(["coffee"]);
    const requestId = "forged-order-customer-email";
    const request = await seedPendingRequest(requestId, items);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await transitionToReady(adminDb);

    await assertDeniedWithoutRuleEvaluationError(
      approvalBatch(
        adminDb,
        requestId,
        request,
        snapshotsFrom(items, prices),
        { customerEmail: "different@example.test" },
      ).commit(),
    );
  });

  it("rejects a phone number that differs from the original request", async () => {
    const items = [{ id: "coffee", quantity: 1 }];
    const prices = await seedPriceBookItems(["coffee"]);
    const requestId = "forged-order-phone";
    const request = await seedPendingRequest(requestId, items);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await transitionToReady(adminDb);

    await assertDeniedWithoutRuleEvaluationError(
      approvalBatch(
        adminDb,
        requestId,
        request,
        snapshotsFrom(items, prices),
        { phone: "09999999999" },
      ).commit(),
    );
  });

  it("rejects an order type that differs from the original request", async () => {
    const items = [{ id: "coffee", quantity: 1 }];
    const prices = await seedPriceBookItems(["coffee"]);
    const requestId = "forged-order-type";
    const request = await seedPendingRequest(requestId, items);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await transitionToReady(adminDb);

    await assertDeniedWithoutRuleEvaluationError(
      approvalBatch(
        adminDb,
        requestId,
        request,
        snapshotsFrom(items, prices),
        { orderType: "dine-in" },
      ).commit(),
    );
  });

  it("rejects an address that differs from the original request", async () => {
    const items = [{ id: "coffee", quantity: 1 }];
    const prices = await seedPriceBookItems(["coffee"]);
    const requestId = "forged-order-address";
    const request = await seedPendingRequest(requestId, items);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await transitionToReady(adminDb);

    await assertDeniedWithoutRuleEvaluationError(
      approvalBatch(
        adminDb,
        requestId,
        request,
        snapshotsFrom(items, prices),
        { address: "Different address" },
      ).commit(),
    );
  });

  it("rejects notes that differ from the original request", async () => {
    const items = [{ id: "coffee", quantity: 1 }];
    const prices = await seedPriceBookItems(["coffee"]);
    const requestId = "forged-order-notes";
    const request = await seedPendingRequest(requestId, items);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await transitionToReady(adminDb);

    await assertDeniedWithoutRuleEvaluationError(
      approvalBatch(
        adminDb,
        requestId,
        request,
        snapshotsFrom(items, prices),
        { notes: "Different notes" },
      ).commit(),
    );
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
    await transitionToReady(adminDb);

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
    await transitionToReady(adminDb);
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
    await transitionToReady(adminDb);
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
    await transitionToReady(adminDb);
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
    await transitionToReady(adminDb);
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
    await transitionToReady(
      testEnv.authenticatedContext("admin-1").firestore(),
    );
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

  it("keeps approved historical item prices immutable", async () => {
    const items = [{ id: "coffee", quantity: 1 }];
    const prices = await seedPriceBookItems(["coffee"]);
    const requestId = "immutable-approved-price";
    const request = await seedPendingRequest(requestId, items);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await transitionToReady(adminDb);
    await assertSucceeds(
      approvalBatch(
        adminDb,
        requestId,
        request,
        snapshotsFrom(items, prices),
      ).commit(),
    );

    await assertDeniedWithoutRuleEvaluationError(
      updateDoc(doc(adminDb, `orders/${requestId}`), {
        items: [{ id: "coffee", quantity: 1, priceCents: 999 }],
      }),
    );
    const order = await getDoc(doc(adminDb, `orders/${requestId}`));
    assert.equal(order.data().items[0].priceCents, prices.coffee.priceCents);
  });
});
