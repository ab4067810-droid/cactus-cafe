import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

const projectId = "demo-cactus-cafe-cash-payment";
const rules = readFileSync(
  new URL("../firestore.cash-payment.prototype.rules", import.meta.url),
  "utf8",
);

let testEnv;

function makeOrder(orderId, overrides = {}) {
  return {
    requestId: orderId,
    customerId: "customer-1",
    customerEmail: "customer-1@example.test",
    customerName: "Cafe Customer",
    phone: "09123456789",
    orderType: "takeout",
    address: "",
    notes: "",
    items: [{ id: "coffee", name: "Coffee", quantity: 2, price: 6.17 }],
    total: 12.34,
    status: "Pending",
    createdAt: Timestamp.fromDate(new Date("2026-01-01T00:00:00Z")),
    ...overrides,
  };
}

function makeSelection(orderId, overrides = {}) {
  return {
    requestId: orderId,
    customerId: "customer-1",
    method: "cash",
    timing: "pay_later",
    createdAt: Timestamp.fromDate(new Date("2026-01-01T00:00:00Z")),
    updatedAt: Timestamp.fromDate(new Date("2026-01-01T00:00:00Z")),
    ...overrides,
  };
}

function makeConfirmation(orderId, overrides = {}) {
  return {
    orderId,
    customerId: "customer-1",
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

async function seedEligibleCashOrder(orderId = "order-1", overrides = {}) {
  const {
    order = {},
    selection = {},
  } = overrides;
  await seed(`orders/${orderId}`, makeOrder(orderId, order));
  await seed(
    `paymentSelections/${orderId}`,
    makeSelection(orderId, selection),
  );
}

async function tryConfirm({
  orderId = "order-1",
  uid = "admin-1",
  confirmation = {},
} = {}) {
  const firestore = testEnv.authenticatedContext(uid).firestore();
  return setDoc(
    doc(firestore, "cashPaymentRecords", orderId),
    makeConfirmation(orderId, confirmation),
  );
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
  await seedEligibleCashOrder();
});

after(async () => {
  await testEnv?.cleanup();
});

describe("cash payment confirmation prototype", () => {
  it("allows an admin to confirm the full amount for a cash order", async () => {
    await assertSucceeds(tryConfirm());

    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const record = await getDoc(doc(adminDb, "cashPaymentRecords/order-1"));
    assert.deepEqual(record.data(), {
      orderId: "order-1",
      customerId: "customer-1",
      amountDue: 12.34,
      amountReceived: 12.34,
      paymentStatus: "paid",
      confirmedBy: "admin-1",
      confirmedAt: record.data().confirmedAt,
      createdAt: record.data().createdAt,
      updatedAt: record.data().updatedAt,
    });
    assert.equal(record.data().confirmedAt.toMillis(), record.data().createdAt.toMillis());
    assert.equal(record.data().confirmedAt.toMillis(), record.data().updatedAt.toMillis());
  });

  it("denies customer confirmation", async () => {
    await assertFails(tryConfirm({ uid: "customer-1" }));
  });

  it("denies unauthenticated confirmation", async () => {
    const firestore = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(
      doc(firestore, "cashPaymentRecords/order-1"),
      makeConfirmation("order-1"),
    ));
  });

  it("denies confirmation by a non-admin account", async () => {
    await seed("users/staff-1", { role: "staff" });
    await assertFails(tryConfirm({ uid: "staff-1" }));
  });

  it("denies cash confirmation when the selection is for QR", async () => {
    await seed("paymentSelections/order-1", makeSelection("order-1", {
      method: "qr",
    }));
    await assertFails(tryConfirm());
  });

  it("denies confirmation when the order is missing", async () => {
    await assertFails(tryConfirm({ orderId: "missing-order" }));
  });

  it("denies a customer ID that differs from the order", async () => {
    await assertFails(tryConfirm({
      confirmation: { customerId: "customer-2" },
    }));
  });

  it("denies an amount due different from the trusted order total", async () => {
    await assertFails(tryConfirm({
      confirmation: { amountDue: 99.99 },
    }));
  });

  it("denies a customer-inflated amount received", async () => {
    await assertFails(tryConfirm({
      confirmation: { amountReceived: 99.99 },
    }));
  });

  it("denies partial cash from marking an order paid", async () => {
    await assertFails(tryConfirm({
      confirmation: { amountReceived: 5 },
    }));
  });

  it("denies a confirming admin UID that differs from the authenticated admin", async () => {
    await assertFails(tryConfirm({
      confirmation: { confirmedBy: "admin-2" },
    }));
  });

  it("requires request-time confirmation timestamp", async () => {
    await assertFails(tryConfirm({
      confirmation: {
        confirmedAt: Timestamp.fromDate(new Date("2000-01-01T00:00:00Z")),
      },
    }));
  });

  it("requires request-time creation and update timestamps", async () => {
    const oldTimestamp = Timestamp.fromDate(new Date("2000-01-01T00:00:00Z"));
    await assertFails(tryConfirm({
      confirmation: { createdAt: oldTimestamp },
    }));
    await assertFails(tryConfirm({
      confirmation: { updatedAt: oldTimestamp },
    }));
  });

  it("denies a second confirmation for the same order", async () => {
    await assertSucceeds(tryConfirm());
    await assertFails(tryConfirm());
  });

  it("denies updating or deleting an existing confirmation", async () => {
    await assertSucceeds(tryConfirm());
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const record = doc(adminDb, "cashPaymentRecords/order-1");
    await assertFails(updateDoc(record, { amountReceived: 0 }));
    await assertFails(deleteDoc(record));
  });

  it("denies confirmation for a cancelled order", async () => {
    await seed("orders/order-1", makeOrder("order-1", {
      status: "Cancelled",
    }));
    await assertFails(tryConfirm());
  });

  it("leaves the order fulfillment status unchanged after confirmation", async () => {
    await assertSucceeds(tryConfirm());
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const order = await getDoc(doc(context.firestore(), "orders/order-1"));
      assert.equal(order.data().status, "Pending");
    });
  });
});
