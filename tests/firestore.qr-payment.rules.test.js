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
  updateDoc,
  writeBatch,
} from "firebase/firestore";

const projectId = "demo-cactus-cafe-qr-payment";
const rules = readFileSync(
  new URL("../firestore.rules", import.meta.url),
  "utf8",
);

let testEnv;

function makeOrder(orderId, customerId = "customer-1", overrides = {}) {
  return {
    requestId: orderId,
    customerId,
    total: 12.34,
    status: "Pending",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeSelection(
  orderId,
  customerId = "customer-1",
  method = "qr",
  timing = "advance",
) {
  return {
    requestId: orderId,
    customerId,
    method,
    timing,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
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
  referenceNumber = `QR-REF-${attemptNumber}`,
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

function seed(path, data) {
  return testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(path).set(data);
  });
}

async function seedQrOrder(
  orderId,
  customerId = "customer-1",
  timing = "advance",
  overrides = {},
) {
  const {
    method = "qr",
    includeSelection = true,
    includeRequestId = true,
    ...orderOverrides
  } = overrides;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const orderData = makeOrder(orderId, customerId, orderOverrides);
    if (!includeRequestId) delete orderData.requestId;
    await firestore.doc(`orders/${orderId}`).set(orderData);
    if (includeSelection) {
      await firestore.doc(`paymentSelections/${orderId}`).set(
        makeSelection(orderId, customerId, method, timing),
      );
    }
  });
}

function paymentRefs(firestore, orderId, attemptNumber = 1) {
  return {
    record: doc(firestore, `paymentRecords/${orderId}`),
    submission: doc(
      firestore,
      `paymentRecords/${orderId}/submissions/attempt-${attemptNumber}`,
    ),
  };
}

async function submitFirst(db, orderId, referenceNumber = "QR-REF-1", amountDue = 1234) {
  const { record, submission } = paymentRefs(db, orderId);
  const batch = writeBatch(db);
  batch.set(record, makeRecord(orderId, "customer-1", { amountDue }));
  batch.set(
    submission,
    makeSubmission(orderId, 1, "customer-1", referenceNumber),
  );
  await batch.commit();
}

async function submitNext(db, orderId, attemptNumber, referenceNumber) {
  const { record, submission } = paymentRefs(db, orderId, attemptNumber);
  const batch = writeBatch(db);
  batch.update(paymentRefs(db, orderId).record, {
    paymentStatus: "pending_review",
    attemptCount: attemptNumber,
    currentSubmissionId: `attempt-${attemptNumber}`,
    updatedAt: serverTimestamp(),
    lastSubmittedAt: serverTimestamp(),
  });
  batch.set(
    submission,
    makeSubmission(orderId, attemptNumber, "customer-1", referenceNumber),
  );
  await batch.commit();
}

async function adminReject(adminDb, orderId, attemptNumber, reason) {
  const { record } = paymentRefs(adminDb, orderId);
  const { submission } = paymentRefs(adminDb, orderId, attemptNumber);
  const batch = writeBatch(adminDb);
  batch.update(record, {
    paymentStatus: attemptNumber === 3 ? "admin_review_required" : "rejected",
    updatedAt: serverTimestamp(),
  });
  batch.update(submission, {
    status: "rejected",
    reviewedAt: serverTimestamp(),
    reviewedBy: "admin-1",
    rejectionReason: reason,
  });
  await batch.commit();
}

async function adminVerify(adminDb, orderId, attemptNumber) {
  const { record } = paymentRefs(adminDb, orderId);
  const { submission } = paymentRefs(adminDb, orderId, attemptNumber);
  const batch = writeBatch(adminDb);
  batch.update(record, {
    paymentStatus: "paid",
    updatedAt: serverTimestamp(),
    verifiedAt: serverTimestamp(),
    verifiedBy: "admin-1",
  });
  batch.update(submission, {
    status: "verified",
    reviewedAt: serverTimestamp(),
    reviewedBy: "admin-1",
    rejectionReason: "",
  });
  await batch.commit();
}

async function prepareThirdRejection(orderId) {
  await seedQrOrder(orderId);
  const customerDb = testEnv.authenticatedContext("customer-1").firestore();
  const adminDb = testEnv.authenticatedContext("admin-1").firestore();
  await submitFirst(customerDb, orderId);
  await adminReject(adminDb, orderId, 1, "First rejection");
  await submitNext(customerDb, orderId, 2, "QR-REF-2");
  await adminReject(adminDb, orderId, 2, "Second rejection");
  await submitNext(customerDb, orderId, 3, "QR-REF-3");
  await adminReject(adminDb, orderId, 3, "Third rejection");
  return { customerDb, adminDb };
}

async function adminResolve(adminDb, orderId, paymentStatus, fields = {}) {
  await updateDoc(paymentRefs(adminDb, orderId).record, {
    paymentStatus,
    updatedAt: serverTimestamp(),
    resolvedAt: serverTimestamp(),
    resolvedBy: "admin-1",
    ...(paymentStatus === "paid"
      ? {
          verifiedAt: serverTimestamp(),
          verifiedBy: "admin-1",
        }
      : {
          verifiedAt: null,
          verifiedBy: "",
          ...fields,
        }),
    ...fields,
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
  await seed("users/admin-1", { role: "admin" });
});

after(async () => {
  await testEnv?.cleanup();
});

describe("QR payment reference submission", () => {
  for (const timing of ["advance", "pay_later"]) {
    it(`allows a QR ${timing} order to submit its first reference`, async () => {
      await seedQrOrder("order-1", "customer-1", timing);
      const customerDb = testEnv.authenticatedContext("customer-1").firestore();

      await assertSucceeds(submitFirst(customerDb, "order-1"));

      const { record, submission } = paymentRefs(customerDb, "order-1");
      const [recordSnapshot, submissionSnapshot] = await Promise.all([
        getDoc(record),
        getDoc(submission),
      ]);
      assert.equal(recordSnapshot.data().amountDue, 1234);
      assert.equal(recordSnapshot.data().paymentStatus, "pending_review");
      assert.equal(submissionSnapshot.data().status, "pending_review");
    });
  }

  it("denies reference submissions for cash orders", async () => {
    await seedQrOrder("cash-order", "customer-1", "advance", {
      method: "cash",
    });
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(submitFirst(customerDb, "cash-order"));
  });

  it("denies unauthenticated and other-customer submissions", async () => {
    await seedQrOrder("owned-order");
    const unauthenticatedDb = testEnv.unauthenticatedContext().firestore();
    const otherCustomerDb = testEnv.authenticatedContext("customer-2").firestore();

    await assertFails(submitFirst(unauthenticatedDb, "owned-order"));
    await assertFails(submitFirst(otherCustomerDb, "owned-order"));
  });

  it("rejects empty, whitespace-only, and oversized references", async () => {
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();

    for (const [orderId, referenceNumber] of [
      ["empty-reference", ""],
      ["whitespace-reference", "   "],
      ["oversized-reference", "R".repeat(101)],
    ]) {
      await seedQrOrder(orderId);
      await assertFails(submitFirst(customerDb, orderId, referenceNumber));
    }
  });

  it("derives integer centavos from the trusted order total", async () => {
    await seedQrOrder("wrong-amount");
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(submitFirst(customerDb, "wrong-amount", "QR-REF", 1235));
  });

  it("requires the parent and first submission to be created atomically", async () => {
    await seedQrOrder("atomic-order");
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const { record, submission } = paymentRefs(customerDb, "atomic-order");

    await assertFails(
      setDoc(record, makeRecord("atomic-order")),
    );
    await assertFails(
      setDoc(
        submission,
        makeSubmission("atomic-order"),
      ),
    );
    await assertSucceeds(submitFirst(customerDb, "atomic-order"));
  });

  it("denies customer-supplied review fields on initial submissions", async () => {
    await seedQrOrder("review-fields-order");
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const { record, submission } = paymentRefs(customerDb, "review-fields-order");
    const batch = writeBatch(customerDb);
    batch.set(record, makeRecord("review-fields-order"));
    batch.set(
      submission,
      makeSubmission("review-fields-order", 1, "customer-1", "QR-REF-1", {
        status: "verified",
        reviewedAt: serverTimestamp(),
        reviewedBy: "customer-1",
      }),
    );

    await assertFails(batch.commit());
  });

  it("allows resubmission only after rejection and in the next numbered slot", async () => {
    await seedQrOrder("sequence-order");
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await submitFirst(customerDb, "sequence-order");
    await assertFails(submitNext(customerDb, "sequence-order", 2, "QR-REF-2"));
    await assertFails(submitNext(customerDb, "sequence-order", 3, "QR-REF-3"));

    await adminReject(adminDb, "sequence-order", 1, "Reference not found");
    await assertFails(submitNext(customerDb, "sequence-order", 3, "QR-REF-3"));
    await assertSucceeds(
      submitNext(customerDb, "sequence-order", 2, "QR-REF-2"),
    );
    await assertFails(submitNext(customerDb, "sequence-order", 3, "QR-REF-3"));
  });

  it("denies duplicate attempt numbers", async () => {
    await seedQrOrder("duplicate-order");
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const { submission } = paymentRefs(customerDb, "duplicate-order");

    await submitFirst(customerDb, "duplicate-order");
    await assertFails(
      setDoc(
        submission,
        makeSubmission("duplicate-order", 1, "customer-1", "QR-REF-DUP"),
      ),
    );
  });

  it("allows only one concurrent resubmission for a numbered attempt", async () => {
    await seedQrOrder("concurrent-order");
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await submitFirst(customerDb, "concurrent-order");
    await adminReject(adminDb, "concurrent-order", 1, "Incorrect reference");

    const results = await Promise.allSettled([
      submitNext(customerDb, "concurrent-order", 2, "QR-REF-2A"),
      submitNext(customerDb, "concurrent-order", 2, "QR-REF-2B"),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  });

  it("allows three actual submissions and requires admin review after the third rejection", async () => {
    await seedQrOrder("limit-order");
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await submitFirst(customerDb, "limit-order");
    await adminReject(adminDb, "limit-order", 1, "First rejection");
    await submitNext(customerDb, "limit-order", 2, "QR-REF-2");
    await adminReject(adminDb, "limit-order", 2, "Second rejection");
    await submitNext(customerDb, "limit-order", 3, "QR-REF-3");
    await adminReject(adminDb, "limit-order", 3, "Third rejection");

    const { record } = paymentRefs(customerDb, "limit-order");
    const recordSnapshot = await getDoc(record);
    assert.equal(recordSnapshot.data().attemptCount, 3);
    assert.equal(recordSnapshot.data().paymentStatus, "admin_review_required");

    await assertFails(submitNext(customerDb, "limit-order", 4, "QR-REF-4"));
  });

  it("allows an administrator to resolve a third rejection as paid without changing submission history", async () => {
    const { customerDb, adminDb } = await prepareThirdRejection("resolve-paid");
    const record = paymentRefs(customerDb, "resolve-paid").record;
    const historyBefore = await Promise.all(
      [1, 2, 3].map(async (attemptNumber) =>
        (await getDoc(
          paymentRefs(customerDb, "resolve-paid", attemptNumber).submission,
        )).data(),
      ),
    );

    await assertSucceeds(adminResolve(adminDb, "resolve-paid", "paid"));

    const recordData = (await getDoc(record)).data();
    assert.equal(recordData.paymentStatus, "paid");
    assert.equal(recordData.attemptCount, 3);
    assert.equal(recordData.currentSubmissionId, "attempt-3");
    assert.equal(recordData.verifiedBy, "admin-1");
    assert.ok(recordData.verifiedAt);
    assert.equal(recordData.resolvedBy, "admin-1");
    assert.ok(recordData.resolvedAt);
    assert.equal(recordData.resolutionReason, "");
    const orderSnapshot = await getDoc(doc(customerDb, "orders/resolve-paid"));
    assert.equal(orderSnapshot.data().status, "Pending");
    const historyAfter = await Promise.all(
      [1, 2, 3].map(async (attemptNumber) =>
        (await getDoc(
          paymentRefs(customerDb, "resolve-paid", attemptNumber).submission,
        )).data(),
      ),
    );
    assert.deepEqual(historyAfter, historyBefore);
    await assertFails(submitNext(customerDb, "resolve-paid", 4, "QR-REF-4"));
  });

  it("allows an administrator to finally reject a third rejection with a reason", async () => {
    const { customerDb, adminDb } = await prepareThirdRejection("resolve-rejected");
    const record = paymentRefs(customerDb, "resolve-rejected").record;
    const historyBefore = await Promise.all(
      [1, 2, 3].map(async (attemptNumber) =>
        (await getDoc(
          paymentRefs(customerDb, "resolve-rejected", attemptNumber).submission,
        )).data(),
      ),
    );

    await assertSucceeds(
      adminResolve(adminDb, "resolve-rejected", "rejected", {
        resolutionReason: "Transaction could not be independently verified",
      }),
    );

    const recordData = (await getDoc(record)).data();
    assert.equal(recordData.paymentStatus, "rejected");
    assert.equal(recordData.attemptCount, 3);
    assert.equal(
      recordData.resolutionReason,
      "Transaction could not be independently verified",
    );
    assert.equal(recordData.resolvedBy, "admin-1");
    assert.ok(recordData.resolvedAt);
    assert.equal(recordData.verifiedAt, null);
    assert.equal(recordData.verifiedBy, "");
    const orderSnapshot = await getDoc(
      doc(customerDb, "orders/resolve-rejected"),
    );
    assert.equal(orderSnapshot.data().status, "Pending");
    const historyAfter = await Promise.all(
      [1, 2, 3].map(async (attemptNumber) =>
        (await getDoc(
          paymentRefs(customerDb, "resolve-rejected", attemptNumber).submission,
        )).data(),
      ),
    );
    assert.deepEqual(historyAfter, historyBefore);
    await assertFails(
      submitNext(customerDb, "resolve-rejected", 4, "QR-REF-4"),
    );
  });

  it("denies missing, blank, and oversized final rejection reasons", async () => {
    for (const [orderId, fields] of [
      ["resolve-no-reason", {}],
      ["resolve-blank-reason", { resolutionReason: "   " }],
      ["resolve-long-reason", { resolutionReason: "R".repeat(501) }],
    ]) {
      const { adminDb } = await prepareThirdRejection(orderId);
      await assertFails(
        adminResolve(adminDb, orderId, "rejected", fields),
      );
    }
  });

  it("denies non-admin and customer resolution attempts", async () => {
    const { customerDb } = await prepareThirdRejection("resolve-auth");
    await seed("users/staff-1", { role: "staff" });
    const staffDb = testEnv.authenticatedContext("staff-1").firestore();
    const paidFields = {
      verifiedAt: serverTimestamp(),
      verifiedBy: "staff-1",
    };

    await assertFails(
      adminResolve(staffDb, "resolve-auth", "paid", paidFields),
    );
    await assertFails(
      adminResolve(customerDb, "resolve-auth", "paid", {
        verifiedAt: serverTimestamp(),
        verifiedBy: "customer-1",
      }),
    );
  });

  it("denies invalid resolution status transitions and paid resolutions without verification metadata", async () => {
    const { adminDb } = await prepareThirdRejection("resolve-invalid-status");
    const record = paymentRefs(adminDb, "resolve-invalid-status").record;

    for (const paymentStatus of [
      "pending_review",
      "admin_review_required",
      "approved",
    ]) {
      await assertFails(
        updateDoc(record, {
          paymentStatus,
          updatedAt: serverTimestamp(),
        }),
      );
    }
    await assertFails(
      updateDoc(record, {
        paymentStatus: "paid",
        updatedAt: serverTimestamp(),
        resolvedAt: serverTimestamp(),
        resolvedBy: "admin-1",
        resolutionReason: "",
      }),
    );
  });

  it("preserves prior rejection reasons and submission timestamps", async () => {
    await seedQrOrder("history-order");
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await submitFirst(customerDb, "history-order");
    const first = paymentRefs(customerDb, "history-order", 1).submission;
    const firstSubmittedAt = (await getDoc(first)).data().submittedAt;

    await adminReject(adminDb, "history-order", 1, "Transfer not located");
    await submitNext(customerDb, "history-order", 2, "QR-REF-2");

    const firstSnapshot = await getDoc(first);
    assert.equal(firstSnapshot.data().rejectionReason, "Transfer not located");
    assert.deepEqual(firstSnapshot.data().submittedAt, firstSubmittedAt);
  });

  it("does not support orders without the linked approved-request selection", async () => {
    await seedQrOrder("direct-order", "customer-1", "advance", {
      includeSelection: false,
      includeRequestId: false,
    });
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(submitFirst(customerDb, "direct-order"));
  });
});

describe("QR payment record access and admin decisions", () => {
  it("allows only the owner and administrators to read payment records", async () => {
    await seedQrOrder("read-order");
    const ownerDb = testEnv.authenticatedContext("customer-1").firestore();
    const otherDb = testEnv.authenticatedContext("customer-2").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await submitFirst(ownerDb, "read-order");
    const { record, submission } = paymentRefs(ownerDb, "read-order");

    await assertSucceeds(getDoc(record));
    await assertSucceeds(getDoc(submission));
    await assertFails(getDoc(paymentRefs(otherDb, "read-order").record));
    await assertFails(getDoc(paymentRefs(otherDb, "read-order").submission));
    await assertSucceeds(getDoc(paymentRefs(adminDb, "read-order").record));
    await assertSucceeds(getDoc(paymentRefs(adminDb, "read-order").submission));
  });

  it("denies customers from editing or deleting submission history or marking paid", async () => {
    await seedQrOrder("immutable-order");
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const { record, submission } = paymentRefs(customerDb, "immutable-order");
    await submitFirst(customerDb, "immutable-order");

    await assertFails(updateDoc(submission, { referenceNumber: "REPLACED" }));
    await assertFails(deleteDoc(submission));
    await assertFails(
      updateDoc(record, {
        paymentStatus: "paid",
        verifiedAt: serverTimestamp(),
        verifiedBy: "customer-1",
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("denies customer review decisions and rejects blank admin reasons", async () => {
    await seedQrOrder("review-auth-order");
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await submitFirst(customerDb, "review-auth-order");

    const { record } = paymentRefs(customerDb, "review-auth-order");
    const { submission } = paymentRefs(customerDb, "review-auth-order", 1);
    const customerBatch = writeBatch(customerDb);
    customerBatch.update(record, {
      paymentStatus: "paid",
      updatedAt: serverTimestamp(),
      verifiedAt: serverTimestamp(),
      verifiedBy: "customer-1",
    });
    customerBatch.update(submission, {
      status: "verified",
      reviewedAt: serverTimestamp(),
      reviewedBy: "customer-1",
    });
    await assertFails(customerBatch.commit());

    for (const rejectionReason of ["   ", "R".repeat(501)]) {
      const adminBatch = writeBatch(adminDb);
      adminBatch.update(paymentRefs(adminDb, "review-auth-order").record, {
        paymentStatus: "rejected",
        updatedAt: serverTimestamp(),
      });
      adminBatch.update(
        paymentRefs(adminDb, "review-auth-order", 1).submission,
        {
          status: "rejected",
          reviewedAt: serverTimestamp(),
          reviewedBy: "admin-1",
          rejectionReason,
        },
      );
      await assertFails(adminBatch.commit());
    }
  });

  it("requires parent and submission review updates to be atomic", async () => {
    await seedQrOrder("atomic-review-order");
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await submitFirst(customerDb, "atomic-review-order");

    const { record } = paymentRefs(adminDb, "atomic-review-order");
    const { submission } = paymentRefs(adminDb, "atomic-review-order", 1);
    await assertFails(
      updateDoc(record, {
        paymentStatus: "rejected",
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(submission, {
        status: "rejected",
        reviewedAt: serverTimestamp(),
        reviewedBy: "admin-1",
        rejectionReason: "Not found",
      }),
    );
    await assertSucceeds(
      adminReject(adminDb, "atomic-review-order", 1, "Not found"),
    );
  });

  it("allows only administrators to verify and keeps fulfillment status independent", async () => {
    await seedQrOrder("verify-order");
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await submitFirst(customerDb, "verify-order");

    const { record } = paymentRefs(customerDb, "verify-order");
    const { submission } = paymentRefs(customerDb, "verify-order", 1);
    const customerBatch = writeBatch(customerDb);
    customerBatch.update(record, {
      paymentStatus: "paid",
      updatedAt: serverTimestamp(),
      verifiedAt: serverTimestamp(),
      verifiedBy: "customer-1",
    });
    customerBatch.update(submission, {
      status: "verified",
      reviewedAt: serverTimestamp(),
      reviewedBy: "customer-1",
      rejectionReason: "",
    });
    await assertFails(customerBatch.commit());

    await assertSucceeds(adminVerify(adminDb, "verify-order", 1));

    const orderSnapshot = await getDoc(
      doc(customerDb, "orders/verify-order"),
    );
    assert.equal(orderSnapshot.data().status, "Pending");
    assert.equal((await getDoc(record)).data().paymentStatus, "paid");
  });

  it("allows administrators to reject a customer's payment", async () => {
    await seedQrOrder("admin-other-order");
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await submitFirst(customerDb, "admin-other-order");
    await assertSucceeds(adminReject(adminDb, "admin-other-order", 1, "Not found"));
  });
});
