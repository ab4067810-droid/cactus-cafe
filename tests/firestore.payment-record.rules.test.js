import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
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

const projectId = "demo-cactus-cafe-payment-record";
const rules = readFileSync(
  new URL("../firestore.rules", import.meta.url),
  "utf8",
);

let testEnv;

function paymentRecordRef(firestore, orderId) {
  return doc(firestore, `paymentRecords/${orderId}`);
}

function submissionRef(firestore, orderId, attemptNumber) {
  return doc(
    firestore,
    `paymentRecords/${orderId}/submissions/attempt-${attemptNumber}`,
  );
}

function makeRecord(orderId, customerId = "customer-1", overrides = {}) {
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
    ...overrides,
  };
}

function makeSubmission(
  orderId,
  attemptNumber = 1,
  customerId = "customer-1",
  referenceNumber = `QRREF${orderId.replace(/[^A-Z0-9]/gi, "").toUpperCase()}${attemptNumber}`,
  overrides = {},
) {
  return {
    orderId,
    customerId,
    attemptNumber,
    referenceNumber,
    submittedAt: serverTimestamp(),
    status: "pending_review",
    reviewedAt: null,
    reviewedBy: "",
    rejectionReason: "",
    ...overrides,
  };
}

async function seed(path, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data);
  });
}

async function assertDeniedWithoutRuleLimitError(operation) {
  let caughtError;
  try {
    await operation;
  } catch (error) {
    caughtError = error;
  }

  assert.ok(caughtError, "Expected Firestore to deny the operation.");
  assert.equal(caughtError.code, "permission-denied");
  assert.doesNotMatch(
    caughtError.message,
    /maximum of 1000 expressions|maximum of 10 document access calls|maximum of 20 document access calls/i,
  );
}

async function seedQrOrder(
  orderId = "order-1",
  customerId = "customer-1",
  method = "qr",
) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const createdAt = Timestamp.fromMillis(1000);
    await Promise.all([
      setDoc(doc(firestore, `orders/${orderId}`), {
        requestId: orderId,
        customerId,
        total: 12.34,
        status: "Pending",
        createdAt,
      }),
      setDoc(doc(firestore, `paymentSelections/${orderId}`), {
        requestId: orderId,
        customerId,
        method,
        timing: "advance",
        createdAt,
        updatedAt: createdAt,
      }),
    ]);
  });
}

async function submitFirst(firestore, orderId, overrides = {}) {
  const batch = writeBatch(firestore);
  const referenceNumber =
    overrides.referenceNumber ||
    `QRREF${orderId.replace(/[^A-Z0-9]/gi, "").toUpperCase()}1`;
  batch.set(
    doc(firestore, `paymentReferences/${referenceNumber}`),
    {
      normalizedReference: referenceNumber,
      sourceType: "order_payment",
      createdBy: "customer-1",
      createdAt: serverTimestamp(),
    },
  );
  batch.set(
    paymentRecordRef(firestore, orderId),
    makeRecord(orderId, "customer-1", overrides.record),
  );
  batch.set(
    submissionRef(firestore, orderId, 1),
    makeSubmission(
      orderId,
      1,
      "customer-1",
      referenceNumber,
      overrides.submission,
    ),
  );
  await batch.commit();
}

async function submitNext(firestore, orderId, attemptNumber) {
  const batch = writeBatch(firestore);
  const referenceNumber =
    `QRREF${orderId.replace(/[^A-Z0-9]/gi, "").toUpperCase()}${attemptNumber}`;
  batch.set(
    doc(firestore, `paymentReferences/${referenceNumber}`),
    {
      normalizedReference: referenceNumber,
      sourceType: "order_payment",
      createdBy: "customer-1",
      createdAt: serverTimestamp(),
    },
  );
  batch.update(paymentRecordRef(firestore, orderId), {
    paymentStatus: "pending_review",
    attemptCount: attemptNumber,
    currentSubmissionId: `attempt-${attemptNumber}`,
    updatedAt: serverTimestamp(),
    lastSubmittedAt: serverTimestamp(),
  });
  batch.set(
    submissionRef(firestore, orderId, attemptNumber),
    makeSubmission(orderId, attemptNumber, "customer-1", referenceNumber),
  );
  await batch.commit();
}

async function adminReject(firestore, orderId, attemptNumber, reason) {
  const batch = writeBatch(firestore);
  batch.update(paymentRecordRef(firestore, orderId), {
    paymentStatus: attemptNumber === 3
      ? "admin_review_required"
      : "rejected",
    updatedAt: serverTimestamp(),
  });
  batch.update(
    submissionRef(firestore, orderId, attemptNumber),
    {
      status: "rejected",
      reviewedAt: serverTimestamp(),
      reviewedBy: "admin-1",
      rejectionReason: reason,
    },
  );
  await batch.commit();
}

async function adminVerify(
  firestore,
  orderId,
  attemptNumber,
  reviewerId = "admin-1",
) {
  const batch = writeBatch(firestore);
  batch.update(paymentRecordRef(firestore, orderId), {
    paymentStatus: "paid",
    updatedAt: serverTimestamp(),
    verifiedAt: serverTimestamp(),
    verifiedBy: reviewerId,
  });
  batch.update(
    submissionRef(firestore, orderId, attemptNumber),
    {
      status: "verified",
      reviewedAt: serverTimestamp(),
      reviewedBy: reviewerId,
      rejectionReason: "",
    },
  );
  await batch.commit();
}

async function prepareThirdRejection(orderId) {
  await seedQrOrder(orderId);
  const customerDb = testEnv.authenticatedContext("customer-1").firestore();
  const adminDb = testEnv.authenticatedContext("admin-1").firestore();
  await submitFirst(customerDb, orderId);
  await adminReject(adminDb, orderId, 1, "First rejection");
  await submitNext(customerDb, orderId, 2);
  await adminReject(adminDb, orderId, 2, "Second rejection");
  await submitNext(customerDb, orderId, 3);
  await adminReject(adminDb, orderId, 3, "Third rejection");
  return { customerDb, adminDb };
}

async function resolveAsAdmin(
  firestore,
  orderId,
  decision,
  resolutionReason = "",
) {
  await updateDoc(paymentRecordRef(firestore, orderId), {
    paymentStatus: decision,
    updatedAt: serverTimestamp(),
    verifiedAt: decision === "paid" ? serverTimestamp() : null,
    verifiedBy: decision === "paid" ? "admin-1" : "",
    resolutionReason,
    resolvedAt: serverTimestamp(),
    resolvedBy: "admin-1",
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await Promise.all([
    seed("users/customer-1", { role: "customer" }),
    seed("users/customer-2", { role: "customer" }),
    seed("users/admin-1", { role: "admin" }),
    seed("users/staff-1", { role: "staff" }),
  ]);
  await seedQrOrder();
});

after(async () => {
  await testEnv?.cleanup();
});

describe("payment record rules", () => {
  it("allows an owner to create and read an atomic QR payment submission", async () => {
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    await assertSucceeds(submitFirst(customerDb, "order-1"));

    const record = await getDoc(paymentRecordRef(customerDb, "order-1"));
    const submission = await getDoc(submissionRef(customerDb, "order-1", 1));
    assert.equal(record.data().amountDue, 1234);
    assert.equal(record.data().paymentStatus, "pending_review");
    assert.equal(submission.data().status, "pending_review");

    const recordQuery = query(
      collection(customerDb, "paymentRecords"),
      where("customerId", "==", "customer-1"),
    );
    const submissionQuery = query(
      collection(
        customerDb,
        "paymentRecords",
        "order-1",
        "submissions",
      ),
      where("customerId", "==", "customer-1"),
    );
    assert.equal((await getDocs(recordQuery)).size, 1);
    assert.equal((await getDocs(submissionQuery)).size, 1);
  });

  it("denies unauthenticated, other-customer, non-QR, and incorrect-amount submissions", async () => {
    const unauthenticatedDb = testEnv.unauthenticatedContext().firestore();
    const otherCustomerDb = testEnv
      .authenticatedContext("customer-2")
      .firestore();
    await assertDeniedWithoutRuleLimitError(
      submitFirst(unauthenticatedDb, "order-1"),
    );
    await assertDeniedWithoutRuleLimitError(
      submitFirst(otherCustomerDb, "order-1"),
    );

    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    await seedQrOrder("cash-order", "customer-1", "cash");
    await seedQrOrder("wrong-amount-order");
    await assertDeniedWithoutRuleLimitError(
      submitFirst(customerDb, "cash-order"),
    );
    await assertDeniedWithoutRuleLimitError(
      submitFirst(customerDb, "wrong-amount-order", {
        record: { amountDue: 1235 },
      }),
    );
  });

  it("requires atomic record/submission creation and rejects customer review fields", async () => {
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    await assertDeniedWithoutRuleLimitError(
      setDoc(
        paymentRecordRef(customerDb, "order-1"),
        makeRecord("order-1"),
      ),
    );
    await assertDeniedWithoutRuleLimitError(
      setDoc(
        submissionRef(customerDb, "order-1", 1),
        makeSubmission("order-1"),
      ),
    );

    await assertDeniedWithoutRuleLimitError(
      submitFirst(customerDb, "order-1", {
        submission: {
          status: "verified",
          reviewedAt: serverTimestamp(),
          reviewedBy: "customer-1",
        },
      }),
    );
    await assertDeniedWithoutRuleLimitError(
      submitFirst(customerDb, "order-1", {
        record: {
          paymentStatus: "paid",
          verifiedAt: serverTimestamp(),
          verifiedBy: "customer-1",
        },
      }),
    );
  });

  it("allows only the owner, admins, and staff to read records and submissions", async () => {
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const otherCustomerDb = testEnv
      .authenticatedContext("customer-2")
      .firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const staffDb = testEnv.authenticatedContext("staff-1").firestore();
    await submitFirst(customerDb, "order-1");

    await assertSucceeds(getDoc(paymentRecordRef(customerDb, "order-1")));
    await assertSucceeds(getDoc(submissionRef(customerDb, "order-1", 1)));
    await assertDeniedWithoutRuleLimitError(
      getDoc(paymentRecordRef(otherCustomerDb, "order-1")),
    );
    await assertDeniedWithoutRuleLimitError(
      getDoc(submissionRef(otherCustomerDb, "order-1", 1)),
    );
    await assertSucceeds(getDoc(paymentRecordRef(adminDb, "order-1")));
    await assertSucceeds(getDoc(submissionRef(adminDb, "order-1", 1)));
    await assertSucceeds(getDoc(paymentRecordRef(staffDb, "order-1")));
    await assertSucceeds(getDoc(submissionRef(staffDb, "order-1", 1)));
  });

  it("allows only sequential retries after an administrator rejection", async () => {
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await submitFirst(customerDb, "order-1");

    await assertDeniedWithoutRuleLimitError(
      submitNext(customerDb, "order-1", 2),
    );
    await assertDeniedWithoutRuleLimitError(
      submitNext(customerDb, "order-1", 3),
    );
    await adminReject(adminDb, "order-1", 1, "Reference not found");
    await assertDeniedWithoutRuleLimitError(
      submitNext(customerDb, "order-1", 3),
    );
    await assertSucceeds(submitNext(customerDb, "order-1", 2));

    const record = await getDoc(paymentRecordRef(customerDb, "order-1"));
    assert.equal(record.data().attemptCount, 2);
    assert.equal(record.data().currentSubmissionId, "attempt-2");
  });

  it("allows admins and staff to verify or reject, but blocks customer transitions", async () => {
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const staffDb = testEnv.authenticatedContext("staff-1").firestore();
    await submitFirst(customerDb, "order-1");

    const customerBatch = writeBatch(customerDb);
    customerBatch.update(paymentRecordRef(customerDb, "order-1"), {
      paymentStatus: "paid",
      updatedAt: serverTimestamp(),
      verifiedAt: serverTimestamp(),
      verifiedBy: "customer-1",
    });
    customerBatch.update(submissionRef(customerDb, "order-1", 1), {
      status: "verified",
      reviewedAt: serverTimestamp(),
      reviewedBy: "customer-1",
      rejectionReason: "",
    });
    await assertDeniedWithoutRuleLimitError(customerBatch.commit());

    await assertSucceeds(adminVerify(staffDb, "order-1", 1, "staff-1"));
    assert.equal(
      (await getDoc(paymentRecordRef(customerDb, "order-1"))).data()
        .paymentStatus,
      "paid",
    );

    await seedQrOrder("order-2");
    await submitFirst(customerDb, "order-2");
    await assertSucceeds(adminVerify(adminDb, "order-2", 1));
  });

  it("requires the record and submission to be reviewed atomically", async () => {
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await submitFirst(customerDb, "order-1");

    await assertDeniedWithoutRuleLimitError(
      updateDoc(paymentRecordRef(adminDb, "order-1"), {
        paymentStatus: "rejected",
        updatedAt: serverTimestamp(),
      }),
    );
    await assertDeniedWithoutRuleLimitError(
      updateDoc(submissionRef(adminDb, "order-1", 1), {
        status: "rejected",
        reviewedAt: serverTimestamp(),
        reviewedBy: "admin-1",
        rejectionReason: "Reference not found",
      }),
    );
    await assertSucceeds(
      adminReject(adminDb, "order-1", 1, "Reference not found"),
    );
  });

  it("denies admin resolution before the third rejection", async () => {
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await submitFirst(customerDb, "order-1");

    await assertDeniedWithoutRuleLimitError(
      resolveAsAdmin(adminDb, "order-1", "paid"),
    );
  });

  it("allows an admin to resolve the third rejection as paid", async () => {
    const { customerDb, adminDb } = await prepareThirdRejection(
      "resolution-paid-order",
    );
    await assertSucceeds(
      resolveAsAdmin(adminDb, "resolution-paid-order", "paid"),
    );

    const record = await getDoc(
      paymentRecordRef(customerDb, "resolution-paid-order"),
    );
    assert.equal(record.data().paymentStatus, "paid");
    assert.equal(record.data().verifiedBy, "admin-1");
    assert.ok(record.data().verifiedAt);
    assert.equal(record.data().resolvedBy, "admin-1");
    assert.ok(record.data().resolvedAt);
    assert.equal(record.data().resolutionReason, "");
  });

  it("allows an admin to finally reject the third rejection and prevents further submissions", async () => {
    const { customerDb, adminDb } = await prepareThirdRejection(
      "resolution-order",
    );
    await assertSucceeds(
      resolveAsAdmin(adminDb, "resolution-order", "rejected", "Not verified"),
    );
    const record = await getDoc(
      paymentRecordRef(customerDb, "resolution-order"),
    );
    assert.equal(record.data().paymentStatus, "rejected");
    assert.equal(record.data().resolutionReason, "Not verified");
    assert.equal(record.data().resolvedBy, "admin-1");
    await assertDeniedWithoutRuleLimitError(
      submitNext(customerDb, "resolution-order", 4),
    );
  });

  it("denies invalid final decisions and all deletes", async () => {
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await submitFirst(customerDb, "order-1");
    await assertDeniedWithoutRuleLimitError(
      deleteDoc(paymentRecordRef(adminDb, "order-1")),
    );
    await assertDeniedWithoutRuleLimitError(
      deleteDoc(submissionRef(adminDb, "order-1", 1)),
    );
    await assertDeniedWithoutRuleLimitError(
      updateDoc(paymentRecordRef(adminDb, "order-1"), {
        paymentStatus: "approved",
        updatedAt: serverTimestamp(),
      }),
    );
  });
});
