import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

const projectId = "demo-cactus-cafe-delivery-operations";
const rules = readFileSync(
  new URL("../firestore.rules", import.meta.url),
  "utf8",
);
let testEnv;

async function seed(path, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data);
  });
}

function makeDeliveryOrder(overrides = {}) {
  return {
    orderType: "delivery",
    status: "Out for Delivery",
    paymentMethod: "cash",
    cashPaymentStatus: "unpaid",
    customerId: "customer-1",
    total: 120,
    ...overrides,
  };
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

after(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, "users/staff-1"), { role: "staff" }),
      setDoc(doc(firestore, "users/customer-1"), { role: "customer" }),
      setDoc(doc(firestore, "orders/delivery-1"), makeDeliveryOrder()),
    ]);
  });
});

describe("delivery order operations rules", () => {
  it("allows staff to hold an unpaid Cash order but not a QR order", async () => {
    const staffDb = testEnv.authenticatedContext("staff-1").firestore();
    await assertSucceeds(
      updateDoc(doc(staffDb, "orders/delivery-1"), { status: "On Hold" }),
    );
    const qrOrder = makeDeliveryOrder({ paymentMethod: "qr" });
    delete qrOrder.cashPaymentStatus;
    await seed("orders/qr-delivery", qrOrder);
    await assertFails(
      updateDoc(doc(staffDb, "orders/qr-delivery"), { status: "On Hold" }),
    );
  });

  it("allows a one-time Cash collection record with server audit metadata", async () => {
    const staffDb = testEnv.authenticatedContext("staff-1").firestore();
    await assertSucceeds(
      updateDoc(doc(staffDb, "orders/delivery-1"), {
        cashPaymentStatus: "paid",
        cashPaymentAt: serverTimestamp(),
        cashPaymentBy: "staff-1",
      }),
    );
    await assertFails(
      updateDoc(doc(staffDb, "orders/delivery-1"), {
        cashPaymentStatus: "paid",
        cashPaymentAt: serverTimestamp(),
        cashPaymentBy: "staff-1",
      }),
    );
  });

  it("starts the arrival clock and only allows the waiting fee after ten minutes", async () => {
    const staffDb = testEnv.authenticatedContext("staff-1").firestore();
    await assertSucceeds(
      updateDoc(doc(staffDb, "orders/delivery-1"), {
        deliveryArrivalAt: serverTimestamp(),
        deliveryArrivalBy: "staff-1",
      }),
    );
    await assertFails(
      updateDoc(doc(staffDb, "orders/delivery-1"), {
        waitingFee: 20,
        waitingFeeAppliedAt: serverTimestamp(),
        waitingFeeAppliedBy: "staff-1",
      }),
    );

    await seed("orders/arrived-early", makeDeliveryOrder({
      deliveryArrivalAt: Timestamp.fromMillis(Date.now() - 11 * 60 * 1000),
      deliveryArrivalBy: "staff-1",
    }));
    await assertSucceeds(
      updateDoc(doc(staffDb, "orders/arrived-early"), {
        waitingFee: 20,
        waitingFeeApplied: true,
        waitingFeeAppliedAt: serverTimestamp(),
        waitingFeeAppliedBy: "staff-1",
      }),
    );
    await assertFails(
      updateDoc(doc(staffDb, "orders/arrived-early"), {
        waitingFee: 20,
        waitingFeeApplied: true,
        waitingFeeAppliedAt: serverTimestamp(),
        waitingFeeAppliedBy: "staff-1",
      }),
    );
  });

  it("marks an unpaid delivery Unreachable after grace and records its fee once", async () => {
    const staffDb = testEnv.authenticatedContext("staff-1").firestore();
    await seed("orders/arrived-unreachable", makeDeliveryOrder({
      deliveryArrivalAt: Timestamp.fromMillis(Date.now() - 11 * 60 * 1000),
      deliveryArrivalBy: "staff-1",
    }));

    await assertSucceeds(
      updateDoc(doc(staffDb, "orders/arrived-unreachable"), {
        status: "Unreachable",
        unreachableAt: serverTimestamp(),
        unreachableBy: "staff-1",
        unreachableReason:
          "Customer could not be reached after the 10-minute delivery grace period.",
        waitingFee: 20,
        waitingFeeApplied: true,
        waitingFeeAppliedAt: serverTimestamp(),
        waitingFeeAppliedBy: "staff-1",
      }),
    );
    await assertFails(
      updateDoc(doc(staffDb, "orders/arrived-unreachable"), {
        waitingFee: 20,
        waitingFeeApplied: true,
        waitingFeeAppliedAt: serverTimestamp(),
        waitingFeeAppliedBy: "staff-1",
      }),
    );

    await seed("orders/already-charged-unreachable", makeDeliveryOrder({
      deliveryArrivalAt: Timestamp.fromMillis(Date.now() - 11 * 60 * 1000),
      deliveryArrivalBy: "staff-1",
      waitingFee: 20,
      waitingFeeApplied: true,
      waitingFeeAppliedAt: Timestamp.fromMillis(Date.now() - 60 * 1000),
      waitingFeeAppliedBy: "staff-1",
    }));
    await assertSucceeds(
      updateDoc(doc(staffDb, "orders/already-charged-unreachable"), {
        status: "Unreachable",
        unreachableAt: serverTimestamp(),
        unreachableBy: "staff-1",
        unreachableReason:
          "Customer could not be reached after the 10-minute delivery grace period.",
      }),
    );
  });

  it("rejects Unreachable for non-delivery, QR, and pre-grace orders", async () => {
    const staffDb = testEnv.authenticatedContext("staff-1").firestore();
    const unreachableUpdate = {
      status: "Unreachable",
      unreachableAt: serverTimestamp(),
      unreachableBy: "staff-1",
      unreachableReason:
        "Customer could not be reached after the 10-minute delivery grace period.",
      waitingFee: 20,
      waitingFeeApplied: true,
      waitingFeeAppliedAt: serverTimestamp(),
      waitingFeeAppliedBy: "staff-1",
    };

    await seed("orders/arrived-too-early", makeDeliveryOrder({
      deliveryArrivalAt: Timestamp.fromMillis(Date.now() - 2 * 60 * 1000),
      deliveryArrivalBy: "staff-1",
    }));
    await seed("orders/non-delivery", makeDeliveryOrder({
      orderType: "takeout",
      deliveryArrivalAt: Timestamp.fromMillis(Date.now() - 11 * 60 * 1000),
      deliveryArrivalBy: "staff-1",
    }));
    const qrOrder = makeDeliveryOrder({
      paymentMethod: "qr",
      deliveryArrivalAt: Timestamp.fromMillis(Date.now() - 11 * 60 * 1000),
      deliveryArrivalBy: "staff-1",
    });
    delete qrOrder.cashPaymentStatus;
    await seed("orders/qr-unreachable", qrOrder);

    await assertFails(
      updateDoc(doc(staffDb, "orders/arrived-too-early"), unreachableUpdate),
    );
    await assertFails(
      updateDoc(doc(staffDb, "orders/non-delivery"), unreachableUpdate),
    );
    await assertFails(
      updateDoc(doc(staffDb, "orders/qr-unreachable"), unreachableUpdate),
    );
  });

  it("allows one valid HTTPS Proof of Delivery URL and prevents replacement", async () => {
    const staffDb = testEnv.authenticatedContext("staff-1").firestore();
    await assertSucceeds(
      updateDoc(doc(staffDb, "orders/delivery-1"), {
        deliveryProofUrl: "https://images.example.test/delivery-1.jpg",
        deliveryProofRecordedAt: serverTimestamp(),
        deliveryProofRecordedBy: "staff-1",
      }),
    );
    await assertFails(
      updateDoc(doc(staffDb, "orders/delivery-1"), {
        deliveryProofUrl: "https://images.example.test/replacement.jpg",
        deliveryProofRecordedAt: serverTimestamp(),
        deliveryProofRecordedBy: "staff-1",
      }),
    );
  });

  it("rejects an insecure or malformed Proof of Delivery URL", async () => {
    const staffDb = testEnv.authenticatedContext("staff-1").firestore();
    for (const deliveryProofUrl of [
      "http://images.example.test/photo.jpg",
      "javascript:alert(1)",
      "https://",
      `https://images.example.test/${"a".repeat(2048)}`,
    ]) {
      await assertFails(
        updateDoc(doc(staffDb, "orders/delivery-1"), {
          deliveryProofUrl,
          deliveryProofRecordedAt: serverTimestamp(),
          deliveryProofRecordedBy: "staff-1",
        }),
      );
    }
  });

  it("allows the order owner to read proof while denying customer proof writes", async () => {
    const proofUrl = "https://images.example.test/delivery-1.jpg";
    const staffDb = testEnv.authenticatedContext("staff-1").firestore();
    await assertSucceeds(
      updateDoc(doc(staffDb, "orders/delivery-1"), {
        deliveryProofUrl: proofUrl,
        deliveryProofRecordedAt: serverTimestamp(),
        deliveryProofRecordedBy: "staff-1",
      }),
    );

    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const orderSnapshot = await assertSucceeds(
      getDoc(doc(customerDb, "orders/delivery-1")),
    );
    assert.equal(orderSnapshot.data().deliveryProofUrl, proofUrl);
    await assertFails(
      updateDoc(doc(customerDb, "orders/delivery-1"), {
        deliveryProofUrl: "https://images.example.test/customer-edit.jpg",
        deliveryProofRecordedAt: serverTimestamp(),
        deliveryProofRecordedBy: "customer-1",
      }),
    );
  });

  it("denies delivery-operation writes from customers", async () => {
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    await assertFails(
      updateDoc(doc(customerDb, "orders/delivery-1"), {
        deliveryArrivalAt: serverTimestamp(),
        deliveryArrivalBy: "customer-1",
      }),
    );
  });
});
