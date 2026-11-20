import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

const projectId = "demo-cactus-cafe-order-reconciliation";
const rules = readFileSync(
  new URL("../firestore.order-reconciliation.prototype.rules", import.meta.url),
  "utf8",
);

let testEnv;

function makeRequest(customerId = "customer-1", overrides = {}) {
  return {
    customerId,
    customerEmail: `${customerId}@example.test`,
    customerName: "Cafe Customer",
    phone: "09123456789",
    items: [{ id: "coffee", quantity: 2 }],
    orderType: "takeout",
    address: "",
    notes: "Emulator order request",
    status: "pending",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

function makeCallableOrder(orderId, customerId = "customer-1", overrides = {}) {
  return {
    requestId: orderId,
    customerId,
    customerEmail: `${customerId}@example.test`,
    customerName: "Cafe Customer",
    phone: "09123456789",
    orderType: "takeout",
    address: "",
    notes: "Emulator order request",
    items: [{
      id: "coffee",
      name: "Coffee",
      price: 6.17,
      quantity: 2,
      subtotal: 12.34,
    }],
    total: 12.34,
    status: "Pending",
    createdAt: Timestamp.fromDate(new Date("2026-01-01T00:00:00Z")),
    ...overrides,
  };
}

function makeSelection(
  orderId,
  customerId = "customer-1",
  method = "cash",
  timing = "pay_later",
) {
  return {
    requestId: orderId,
    customerId,
    method,
    timing,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function makeQrRecord(orderId, customerId = "customer-1") {
  return {
    orderId,
    customerId,
    amountDue: 1234,
    paymentStatus: "pending_review",
    attemptCount: 1,
    currentSubmissionId: "attempt-1",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastSubmittedAt: serverTimestamp(),
    verifiedAt: null,
    verifiedBy: "",
    resolutionReason: "",
    resolvedAt: null,
    resolvedBy: "",
  };
}

function makeQrSubmission(orderId, customerId = "customer-1") {
  return {
    orderId,
    customerId,
    attemptNumber: 1,
    referenceNumber: "QR-REFERENCE-1",
    submittedAt: serverTimestamp(),
    status: "pending_review",
    reviewedAt: null,
    reviewedBy: "",
    rejectionReason: "",
  };
}

function makeCashRecord(orderId, customerId = "customer-1", overrides = {}) {
  return {
    orderId,
    customerId,
    amountDue: 12.34,
    amountReceived: 12.34,
    paymentStatus: "paid",
    confirmedBy: "admin-1",
    confirmedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

async function seed(path, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data);
  });
}

async function seedCallableOrder(
  orderId,
  customerId = "customer-1",
  method = "cash",
) {
  await seed(`orders/${orderId}`, makeCallableOrder(orderId, customerId));
  await seed(
    `paymentSelections/${orderId}`,
    makeSelection(orderId, customerId, method),
  );
}

function approvalBatch(firestore, requestId, adminId) {
  const batch = writeBatch(firestore);
  batch.update(doc(firestore, `orderRequests/${requestId}`), {
    status: "approved",
    orderId: requestId,
    reviewedAt: serverTimestamp(),
    reviewedBy: adminId,
  });
  batch.set(
    doc(firestore, `orders/${requestId}`),
    makeCallableOrder(requestId),
  );
  return batch;
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed("users/admin-1", { role: "admin" });
  await seed("users/customer-1", { role: "customer" });
  await seed("users/customer-2", { role: "customer" });
  await seedCallableOrder("order-1");
  await seedCallableOrder("other-order", "customer-2");
  await seedCallableOrder("qr-order", "customer-1", "qr");
  await seed(
    "orderRequests/approval-request",
    makeRequest("customer-1"),
  );
});

after(async () => {
  await testEnv?.cleanup();
});

describe("isolated order-rules reconciliation", () => {
  it("denies customer direct order creation using the callable schema", async () => {
    const customerDb = testEnv.authenticatedContext(
      "customer-1",
      { email: "customer-1@example.test" },
    ).firestore();
    await assertFails(setDoc(
      doc(customerDb, "orders/customer-created"),
      makeCallableOrder("customer-created"),
    ));
  });

  it("denies admin-client direct order creation", async () => {
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await assertFails(setDoc(
      doc(adminDb, "orders/admin-client-created"),
      makeCallableOrder("admin-client-created"),
    ));
  });

  it("denies customer direct approval and paired order creation", async () => {
    const customerDb = testEnv.authenticatedContext(
      "customer-1",
      { email: "customer-1@example.test" },
    ).firestore();
    await assertFails(approvalBatch(
      customerDb,
      "approval-request",
      "customer-1",
    ).commit());
  });

  it("denies admin-client direct approval and paired order creation", async () => {
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await assertFails(approvalBatch(
      adminDb,
      "approval-request",
      "admin-1",
    ).commit());
  });

  it("allows a customer to read their own callable-shaped order", async () => {
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const order = await getDoc(doc(customerDb, "orders/order-1"));
    assert.equal(order.data().requestId, "order-1");
    assert.equal(order.data().total, 12.34);
  });

  it("denies a customer access to another customer's order", async () => {
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    await assertFails(getDoc(doc(customerDb, "orders/other-order")));
  });

  it("allows administrators to read and list orders", async () => {
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await assertSucceeds(getDoc(doc(adminDb, "orders/order-1")));
    const orders = await getDocs(collection(adminDb, "orders"));
    assert.equal(orders.size, 3);
  });

  it("allows administrators to update fulfillment status only", async () => {
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await assertSucceeds(updateDoc(
      doc(adminDb, "orders/order-1"),
      { status: "Confirmed" },
    ));
    await assertFails(updateDoc(
      doc(adminDb, "orders/order-1"),
      { status: "Refunded" },
    ));
  });

  it("denies administrators changes to order totals, items, and customer ID", async () => {
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const order = doc(adminDb, "orders/order-1");
    await assertFails(updateDoc(order, { total: 99 }));
    await assertFails(updateDoc(order, {
      items: [{ id: "coffee", name: "Coffee", price: 1, quantity: 1, subtotal: 1 }],
    }));
    await assertFails(updateDoc(order, { customerId: "customer-2" }));
  });

  it("denies customers changes to fulfillment or payment-related fields", async () => {
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const order = doc(customerDb, "orders/order-1");
    await assertFails(updateDoc(order, { status: "Completed" }));
    await assertFails(updateDoc(order, { total: 99 }));
    await assertFails(updateDoc(order, { items: [] }));
    await assertFails(updateDoc(order, { paymentStatus: "paid" }));
    await assertFails(updateDoc(order, { amountReceived: 12.34 }));
  });

  it("denies order deletion", async () => {
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await assertFails(deleteDoc(doc(adminDb, "orders/order-1")));
  });

  it("preserves customer payment-selection creation", async () => {
    const customerDb = testEnv.authenticatedContext(
      "customer-1",
      { email: "customer-1@example.test" },
    ).firestore();
    const batch = writeBatch(customerDb);
    batch.set(
      doc(customerDb, "orderRequests/new-selection-request"),
      makeRequest("customer-1"),
    );
    batch.set(
      doc(customerDb, "paymentSelections/new-selection-request"),
      makeSelection("new-selection-request"),
    );
    await assertSucceeds(batch.commit());
  });

  it("preserves atomic QR reference submission", async () => {
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const batch = writeBatch(customerDb);
    batch.set(
      doc(customerDb, "paymentRecords/qr-order"),
      makeQrRecord("qr-order"),
    );
    batch.set(
      doc(customerDb, "paymentRecords/qr-order/submissions/attempt-1"),
      makeQrSubmission("qr-order"),
    );
    await assertSucceeds(batch.commit());
  });

  it("preserves the cash-prototype confirmation rule", async () => {
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await assertSucceeds(setDoc(
      doc(adminDb, "cashPaymentRecords/order-1"),
      makeCashRecord("order-1"),
    ));

    const order = await getDoc(doc(adminDb, "orders/order-1"));
    assert.equal(order.data().status, "Pending");
  });

  it("denies cash confirmation for a QR-selected order", async () => {
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await assertFails(setDoc(
      doc(adminDb, "cashPaymentRecords/qr-order"),
      makeCashRecord("qr-order"),
    ));
  });
});
