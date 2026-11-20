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
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

const projectId = "demo-cactus-cafe-payment-selection";
const rules = readFileSync(
  new URL("../firestore.rules", import.meta.url),
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
    notes: "",
    status: "pending",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

function makeSelection(requestId, customerId = "customer-1", overrides = {}) {
  return {
    requestId,
    customerId,
    method: "cash",
    timing: "advance",
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

async function seedPendingRequest(requestId, customerId = "customer-1") {
  await seed(`orderRequests/${requestId}`, makeRequest(customerId));
}

async function seedSelectionAndRequest(
  requestId,
  customerId = "customer-1",
  requestStatus = "pending",
) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(
      doc(firestore, `orderRequests/${requestId}`),
      makeRequest(customerId, { status: requestStatus }),
    );
    await setDoc(
      doc(firestore, `paymentSelections/${requestId}`),
      makeSelection(requestId, customerId, {
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
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

describe("payment selection atomic creation", () => {
  it("allows an owner to create a valid request and selection in one batch", async () => {
    const customerDb = testEnv.authenticatedContext(
      "customer-1",
      { email: "customer-1@example.test" },
    ).firestore();
    const batch = writeBatch(customerDb);
    batch.set(
      doc(customerDb, "orderRequests/request-1"),
      makeRequest(),
    );
    batch.set(
      doc(customerDb, "paymentSelections/request-1"),
      makeSelection("request-1"),
    );

    await assertSucceeds(batch.commit());

    const selection = await getDoc(
      doc(customerDb, "paymentSelections/request-1"),
    );
    assert.equal(selection.data().method, "cash");
    assert.equal(selection.data().timing, "advance");
  });

  it("preserves valid request creation without requiring a payment selection", async () => {
    const customerDb = testEnv.authenticatedContext(
      "customer-1",
      { email: "customer-1@example.test" },
    ).firestore();

    await assertSucceeds(
      setDoc(
        doc(customerDb, "orderRequests/request-only"),
        makeRequest(),
      ),
    );
  });

  it("rejects a selection without an orderRequest in the same batch", async () => {
    const customerDb = testEnv.authenticatedContext(
      "customer-1",
      { email: "customer-1@example.test" },
    ).firestore();

    await assertFails(
      setDoc(
        doc(customerDb, "paymentSelections/orphan"),
        makeSelection("orphan"),
      ),
    );
  });

  it("rejects selection creation for an already-existing request", async () => {
    await seedPendingRequest("existing-request");
    const customerDb = testEnv.authenticatedContext(
      "customer-1",
      { email: "customer-1@example.test" },
    ).firestore();

    await assertFails(
      setDoc(
        doc(customerDb, "paymentSelections/existing-request"),
        makeSelection("existing-request"),
      ),
    );
  });

  it("rejects an atomic request-selection batch with mismatched ownership", async () => {
    const customerDb = testEnv.authenticatedContext(
      "customer-1",
      { email: "customer-1@example.test" },
    ).firestore();
    const batch = writeBatch(customerDb);
    batch.set(
      doc(customerDb, "orderRequests/mismatched"),
      makeRequest(),
    );
    batch.set(
      doc(customerDb, "paymentSelections/mismatched"),
      makeSelection("mismatched", "customer-2"),
    );

    await assertFails(batch.commit());
    await assertFails(getDoc(doc(customerDb, "orderRequests/mismatched")));
  });

  it("rejects a selection linked to another customer's request", async () => {
    const customerDb = testEnv.authenticatedContext(
      "customer-1",
      { email: "customer-1@example.test" },
    ).firestore();
    const batch = writeBatch(customerDb);
    batch.set(
      doc(customerDb, "orderRequests/other-owner"),
      makeRequest("customer-2"),
    );
    batch.set(
      doc(customerDb, "paymentSelections/other-owner"),
      makeSelection("other-owner"),
    );

    await assertFails(batch.commit());
  });

  it("rejects duplicate atomic creation of an existing payment selection", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      await setDoc(
        doc(firestore, "orderRequests/duplicate"),
        makeRequest("customer-1", { createdAt: new Date() }),
      );
      await setDoc(
        doc(firestore, "paymentSelections/duplicate"),
        makeSelection("duplicate", "customer-1", {
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );
    });

    const customerDb = testEnv.authenticatedContext(
      "customer-1",
      { email: "customer-1@example.test" },
    ).firestore();
    const batch = writeBatch(customerDb);
    batch.set(
      doc(customerDb, "orderRequests/duplicate"),
      makeRequest(),
    );
    batch.set(
      doc(customerDb, "paymentSelections/duplicate"),
      makeSelection("duplicate"),
    );

    await assertFails(batch.commit());
  });

  it("rejects payment selections with malformed creation or update timestamps", async () => {
    const customerDb = testEnv.authenticatedContext(
      "customer-1",
      { email: "customer-1@example.test" },
    ).firestore();

    for (const [requestId, timestampOverrides] of [
      ["bad-created-at", { createdAt: "not-a-timestamp" }],
      ["bad-updated-at", { updatedAt: "not-a-timestamp" }],
    ]) {
      const batch = writeBatch(customerDb);
      batch.set(
        doc(customerDb, `orderRequests/${requestId}`),
        makeRequest(),
      );
      batch.set(
        doc(customerDb, `paymentSelections/${requestId}`),
        makeSelection(requestId, "customer-1", timestampOverrides),
      );

      await assertFails(batch.commit());
    }
  });
});

describe("payment selection ownership and updates", () => {
  it("allows owner reads and pending-request method/timing updates", async () => {
    await seedSelectionAndRequest("request-1");
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();

    await assertSucceeds(
      getDoc(doc(customerDb, "paymentSelections/request-1")),
    );
    await assertSucceeds(
      updateDoc(doc(customerDb, "paymentSelections/request-1"), {
        method: "qr",
        timing: "pay_later",
      }),
    );

    const selection = await getDoc(
      doc(customerDb, "paymentSelections/request-1"),
    );
    assert.equal(selection.data().method, "qr");
    assert.equal(selection.data().timing, "pay_later");
  });

  it("denies customer reads and updates of another customer's selection", async () => {
    await seedSelectionAndRequest("request-1");
    const otherCustomerDb = testEnv.authenticatedContext(
      "customer-2",
    ).firestore();

    await assertFails(
      getDoc(doc(otherCustomerDb, "paymentSelections/request-1")),
    );
    await assertFails(
      updateDoc(doc(otherCustomerDb, "paymentSelections/request-1"), {
        method: "qr",
      }),
    );
    await assertFails(
      getDocs(
        query(
          collection(otherCustomerDb, "paymentSelections"),
          where("customerId", "==", "customer-1"),
        ),
      ),
    );
  });

  it("allows administrators to read selections after request approval", async () => {
    await seedSelectionAndRequest("request-1", "customer-1", "approved");
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertSucceeds(
      getDoc(doc(adminDb, "paymentSelections/request-1")),
    );
    const selections = await assertSucceeds(
      getDocs(collection(adminDb, "paymentSelections")),
    );
    assert.equal(selections.size, 1);
  });

  it("denies customer selection updates after the request is approved", async () => {
    await seedSelectionAndRequest("request-1", "customer-1", "approved");
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(
      updateDoc(doc(customerDb, "paymentSelections/request-1"), {
        method: "qr",
      }),
    );
  });

  it("denies changes beyond method and timing and denies deletion", async () => {
    await seedSelectionAndRequest("request-1");
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const selectionRef = doc(customerDb, "paymentSelections/request-1");

    await assertFails(updateDoc(selectionRef, { customerId: "customer-2" }));
    await assertFails(updateDoc(selectionRef, { requestId: "other-request" }));
    await assertFails(
      updateDoc(selectionRef, { createdAt: serverTimestamp() }),
    );
    await assertFails(updateDoc(selectionRef, { updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(selectionRef));
  });

  it("denies unauthenticated selection reads", async () => {
    await seedSelectionAndRequest("request-1");
    const unauthenticatedDb = testEnv.unauthenticatedContext().firestore();

    await assertFails(
      getDoc(doc(unauthenticatedDb, "paymentSelections/request-1")),
    );
    await assertFails(
      getDocs(collection(unauthenticatedDb, "paymentSelections")),
    );
  });

  it("denies unauthenticated selection creation", async () => {
    const requestId = "unauthenticated-selection";
    await seedPendingRequest(requestId);
    const unauthenticatedDb = testEnv.unauthenticatedContext().firestore();

    await assertFails(
      setDoc(
        doc(unauthenticatedDb, `paymentSelections/${requestId}`),
        makeSelection(requestId),
      ),
    );
  });

  it("denies administrators from creating selections", async () => {
    const adminDb = testEnv.authenticatedContext(
      "admin-1",
      { email: "admin-1@example.test" },
    ).firestore();
    const batch = writeBatch(adminDb);
    batch.set(
      doc(adminDb, "orderRequests/admin-request"),
      makeRequest("admin-1"),
    );
    batch.set(
      doc(adminDb, "paymentSelections/admin-request"),
      makeSelection("admin-request", "admin-1"),
    );

    await assertFails(batch.commit());
  });

  it("denies administrators from updating another customer's selection", async () => {
    await seedSelectionAndRequest("request-1");
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertFails(
      updateDoc(doc(adminDb, "paymentSelections/request-1"), {
        method: "qr",
      }),
    );
  });

  it("denies administrators from updating their own selection", async () => {
    await seedSelectionAndRequest("admin-request", "admin-1");
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertFails(
      updateDoc(doc(adminDb, "paymentSelections/admin-request"), {
        method: "qr",
      }),
    );
  });

  it("denies administrators from deleting a customer's selection", async () => {
    await seedSelectionAndRequest("request-1");
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertFails(
      deleteDoc(doc(adminDb, "paymentSelections/request-1")),
    );
  });
});

describe("payment selection schema validation", () => {
  const invalidCases = [
    ["invalid method", { method: "card" }],
    ["invalid timing", { timing: "later" }],
    ["unexpected field", { paymentStatus: "paid" }],
    ["mismatched request ID", { requestId: "different-request" }],
    ["mismatched customer ID", { customerId: "customer-2" }],
  ];

  for (const [label, overrides] of invalidCases) {
    it(`rejects ${label}`, async () => {
      const customerDb = testEnv.authenticatedContext(
        "customer-1",
        { email: "customer-1@example.test" },
      ).firestore();
      const batch = writeBatch(customerDb);
      batch.set(
        doc(customerDb, `orderRequests/${overrides.requestId || "request-1"}`),
        makeRequest(),
      );
      batch.set(
        doc(customerDb, "paymentSelections/request-1"),
        makeSelection("request-1", "customer-1", overrides),
      );

      await assertFails(batch.commit());
    });
  }
});
