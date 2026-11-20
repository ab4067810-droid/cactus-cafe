import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, it } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

const projectId = "demo-cactus-cafe-prototype-diagnostic";
const rules = readFileSync(
  new URL("../firestore.rules.diagnostic", import.meta.url),
  "utf8",
);

let testEnv;

function makeRequest(overrides = {}) {
  return {
    customerId: "customer-1",
    customerEmail: "customer@example.test",
    customerName: "Cafe Customer",
    phone: "09123456789",
    items: [{ id: "coffee", quantity: 2 }],
    orderType: "takeout",
    address: "",
    notes: "Oat milk",
    status: "pending",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

function makeOrder(request, requestId, overrides = {}) {
  const items = request.items.map(({ id, quantity }) => ({
    id,
    name: id === "coffee" ? "Coffee" : "Menu item",
    price: 4,
    quantity,
    subtotal: 4 * quantity,
  }));

  return {
    requestId,
    customerId: request.customerId,
    customerEmail: request.customerEmail,
    customerName: request.customerName,
    phone: request.phone,
    orderType: request.orderType,
    address: request.address,
    notes: request.notes,
    items,
    total: items.reduce((sum, item) => sum + item.subtotal, 0),
    status: "Pending",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedPendingRequest(requestId, request) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), `orderRequests/${requestId}`),
      request,
    );
  });
}

async function approveOrder(db, requestId, order) {
  const batch = writeBatch(db);
  batch.update(doc(db, `orderRequests/${requestId}`), {
    status: "approved",
    orderId: requestId,
    reviewedAt: serverTimestamp(),
    reviewedBy: "admin-1",
  });
  batch.set(doc(db, `orders/${requestId}`), order);
  await batch.commit();
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
    await setDoc(doc(context.firestore(), "users/admin-1"), {
      role: "admin",
    });
  });
});

after(async () => {
  await testEnv.cleanup();
});

it("diagnostic: allows atomic admin approval and matching order creation", async () => {
  const requestId = "diagnostic-valid-approval";
  const request = makeRequest();
  await seedPendingRequest(requestId, request);
  const adminDb = testEnv.authenticatedContext("admin-1").firestore();

  await assertSucceeds(
    approveOrder(
      adminDb,
      requestId,
      makeOrder(request, requestId),
    ),
  );
});

it("diagnostic: denies order creation without request approval", async () => {
  const requestId = "diagnostic-order-only";
  const request = makeRequest();
  await seedPendingRequest(requestId, request);
  const adminDb = testEnv.authenticatedContext("admin-1").firestore();

  await assertFails(
    setDoc(
      doc(adminDb, `orders/${requestId}`),
      makeOrder(request, requestId),
    ),
  );
});

it("diagnostic: denies customer approval transaction", async () => {
  const requestId = "diagnostic-customer-approval";
  const request = makeRequest();
  await seedPendingRequest(requestId, request);
  const customerDb = testEnv.authenticatedContext("customer-1").firestore();

  await assertFails(
    approveOrder(
      customerDb,
      requestId,
      makeOrder(request, requestId),
    ),
  );
});

it("diagnostic: denies approval with changed customer details", async () => {
  const requestId = "diagnostic-changed-customer";
  const request = makeRequest();
  await seedPendingRequest(requestId, request);
  const adminDb = testEnv.authenticatedContext("admin-1").firestore();
  const changedRequest = {
    ...request,
    customerId: "customer-2",
    customerEmail: "other@example.test",
    customerName: "Different Customer",
  };
  const batch = writeBatch(adminDb);
  batch.update(doc(adminDb, `orderRequests/${requestId}`), {
    customerId: changedRequest.customerId,
    customerEmail: changedRequest.customerEmail,
    customerName: changedRequest.customerName,
    status: "approved",
    orderId: requestId,
    reviewedAt: serverTimestamp(),
    reviewedBy: "admin-1",
  });
  batch.set(
    doc(adminDb, `orders/${requestId}`),
    makeOrder(changedRequest, requestId),
  );

  await assertFails(batch.commit());
});
