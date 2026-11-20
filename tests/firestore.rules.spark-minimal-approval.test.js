import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
} from "firebase/firestore";

const projectId = "demo-cactus-cafe-spark-minimal-approval";
const rules = readFileSync(
  new URL("../firestore.rules.spark-minimal-approval", import.meta.url),
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
    createdAt: Timestamp.fromDate(new Date("2025-01-01T00:00:00Z")),
    ...overrides,
  };
}

function makeOrder(request = makeRequest(), requestId = "request-1") {
  return {
    requestId,
    customerId: request.customerId,
    customerEmail: request.customerEmail,
    customerName: request.customerName,
    phone: request.phone,
    orderType: request.orderType,
    address: request.address,
    notes: request.notes,
    items: [{ id: "coffee", name: "Coffee", price: 4, quantity: 2, subtotal: 8 }],
    total: 8,
    status: "Pending",
    createdAt: serverTimestamp(),
  };
}

async function seedRequest(requestId = "request-1", request = makeRequest()) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `orderRequests/${requestId}`), request);
  });
}

async function seedOrder(requestId = "request-1", request = makeRequest()) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), `orders/${requestId}`),
      makeOrder(request, requestId),
    );
  });
}

function approvalBatch(db, requestId = "request-1", request = makeRequest()) {
  const batch = writeBatch(db);
  batch.update(doc(db, `orderRequests/${requestId}`), {
    status: "approved",
    orderId: requestId,
    reviewedAt: serverTimestamp(),
    reviewedBy: "admin-1",
  });
  batch.set(
    doc(db, `orders/${requestId}`),
    makeOrder(request, requestId),
  );
  return batch;
}

async function seedApprovedRequest(requestId = "request-1") {
  const request = makeRequest({
    status: "approved",
    orderId: requestId,
    reviewedAt: Timestamp.fromDate(new Date("2025-01-02T00:00:00Z")),
    reviewedBy: "admin-1",
  });
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), `orderRequests/${requestId}`),
      request,
    );
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "users/admin-1"), { role: "admin" }),
      setDoc(doc(db, "users/customer-1"), { role: "customer" }),
    ]);
  });
  await seedRequest();
});

describe("Spark minimal Admin order approval rules", () => {
  it("allows an Admin to create an order and approve its request in one batch", async () => {
    const db = testEnv.authenticatedContext("admin-1").firestore();
    await assertSucceeds(approvalBatch(db).commit());
  });

  it("denies Admin order creation without request approval", async () => {
    const db = testEnv.authenticatedContext("admin-1").firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, "orders/request-1"), makeOrder());
    await assertFails(batch.commit());
  });

  it("denies Admin request approval without creating its order", async () => {
    const db = testEnv.authenticatedContext("admin-1").firestore();
    const batch = writeBatch(db);
    batch.update(doc(db, "orderRequests/request-1"), {
      status: "approved",
      orderId: "request-1",
      reviewedAt: serverTimestamp(),
      reviewedBy: "admin-1",
    });
    await assertFails(batch.commit());
  });

  it("denies approval when a matching order already exists", async () => {
    const request = makeRequest();
    await seedOrder("request-1", request);
    const db = testEnv.authenticatedContext("admin-1").firestore();
    const batch = writeBatch(db);
    batch.update(doc(db, "orderRequests/request-1"), {
      status: "approved",
      orderId: "request-1",
      reviewedAt: serverTimestamp(),
      reviewedBy: "admin-1",
    });
    await assertFails(batch.commit());
  });

  it("denies customer approval of a pending request", async () => {
    const db = testEnv.authenticatedContext("customer-1").firestore();
    await assertFails(approvalBatch(db).commit());
  });

  it("denies order creation for an already-approved request", async () => {
    await seedApprovedRequest();
    const db = testEnv.authenticatedContext("admin-1").firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, "orders/request-1"), makeOrder());
    await assertFails(batch.commit());
  });
});
