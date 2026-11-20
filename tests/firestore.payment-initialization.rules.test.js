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
} from "firebase/firestore";

const projectId = "demo-cactus-cafe-payment-initialization";
const rules = readFileSync(
  new URL("../firestore.rules.payment-initialization-prototype", import.meta.url),
  "utf8",
);

let testEnv;

function makeRequest(
  orderId,
  customerId = "customer-1",
  overrides = {},
) {
  return {
    customerId,
    status: "approved",
    orderId,
    ...overrides,
  };
}

function makeOrder(
  orderId,
  customerId = "customer-1",
  overrides = {},
) {
  return {
    requestId: orderId,
    customerId,
    total: 123.45,
    ...overrides,
  };
}

function makeSelection(
  orderId,
  customerId = "customer-1",
  overrides = {},
) {
  return {
    requestId: orderId,
    customerId,
    method: "qr",
    timing: "advance",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePayment(
  orderId,
  customerId = "customer-1",
  overrides = {},
) {
  return {
    orderId,
    requestId: orderId,
    customerId,
    method: "qr",
    timing: "advance",
    currency: "PHP",
    amountDueMinor: 12345,
    amountReceivedMinor: 0,
    amountRefundedMinor: 0,
    status: "awaiting_payment",
    initializedBy: "admin-1",
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

async function seedApprovedOrder(orderId = "order-1", overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(
      doc(firestore, `orderRequests/${orderId}`),
      makeRequest(orderId, "customer-1", overrides.request),
    );
    await setDoc(
      doc(firestore, `orders/${orderId}`),
      makeOrder(orderId, "customer-1", overrides.order),
    );
    await setDoc(
      doc(firestore, `paymentSelections/${orderId}`),
      makeSelection(orderId, "customer-1", overrides.selection),
    );
  });
}

async function createPayment(
  payment = makePayment("order-1"),
  actorId = "admin-1",
) {
  const actorDb = testEnv.authenticatedContext(actorId).firestore();
  return setDoc(doc(actorDb, `orderPayments/${payment.orderId}`), payment);
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

describe("order payment initialization", () => {
  it("allows valid administrator initialization from the approved server-priced order", async () => {
    await seedApprovedOrder();

    await assertSucceeds(createPayment());

    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const summary = await getDoc(doc(adminDb, "orderPayments/order-1"));
    assert.equal(summary.data().amountDueMinor, 12345);
    assert.equal(summary.data().status, "awaiting_payment");
    assert.equal(summary.data().amountReceivedMinor, 0);
    assert.equal(summary.data().amountRefundedMinor, 0);
  });

  it("allows Pay Later initialization only in the unpaid state", async () => {
    await seedApprovedOrder("order-later", {
      selection: { method: "cash", timing: "pay_later" },
    });

    await assertSucceeds(
      createPayment(makePayment("order-later", "customer-1", {
        method: "cash",
        timing: "pay_later",
        status: "unpaid",
      })),
    );
  });

  it("denies non-administrator initialization", async () => {
    await seedApprovedOrder();

    await assertFails(
      createPayment(makePayment("order-1"), "customer-1"),
    );
  });

  it("allows customers to read only their own summaries", async () => {
    await seedApprovedOrder("order-1");
    await seedApprovedOrder("order-2", {
      request: { customerId: "customer-2" },
      order: { customerId: "customer-2" },
      selection: { customerId: "customer-2" },
    });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(
        doc(adminDb, "orderPayments/order-1"),
        makePayment("order-1"),
      );
      await setDoc(
        doc(adminDb, "orderPayments/order-2"),
        makePayment("order-2", "customer-2"),
      );
    });

    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    await assertSucceeds(getDoc(doc(customerDb, "orderPayments/order-1")));
    await assertFails(getDoc(doc(customerDb, "orderPayments/order-2")));
    const ownSummaries = await assertSucceeds(
      getDocs(
        query(
          collection(customerDb, "orderPayments"),
          where("customerId", "==", "customer-1"),
        ),
      ),
    );
    assert.equal(ownSummaries.size, 1);
  });

  it("allows administrators to read summaries", async () => {
    await seedApprovedOrder();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "orderPayments/order-1"),
        makePayment("order-1"),
      );
    });
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertSucceeds(getDoc(doc(adminDb, "orderPayments/order-1")));
    const summaries = await assertSucceeds(
      getDocs(collection(adminDb, "orderPayments")),
    );
    assert.equal(summaries.size, 1);
  });

  for (const [label, seededDocuments] of [
    ["order", ["request", "selection"]],
    ["request", ["order", "selection"]],
    ["payment selection", ["order", "request"]],
  ]) {
    it(`rejects initialization when the ${label} is missing`, async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const firestore = context.firestore();
        if (seededDocuments.includes("request")) {
          await setDoc(
            doc(firestore, "orderRequests/order-1"),
            makeRequest("order-1"),
          );
        }
        if (seededDocuments.includes("order")) {
          await setDoc(
            doc(firestore, "orders/order-1"),
            makeOrder("order-1"),
          );
        }
        if (seededDocuments.includes("selection")) {
          await setDoc(
            doc(firestore, "paymentSelections/order-1"),
            makeSelection("order-1"),
          );
        }
      });

      await assertFails(createPayment());
    });
  }

  it("rejects an unapproved request", async () => {
    await seedApprovedOrder("order-1", {
      request: { status: "pending" },
    });

    await assertFails(createPayment());
  });

  it("rejects mismatched customer IDs across the linked documents", async () => {
    await seedApprovedOrder("order-1", {
      selection: { customerId: "customer-2" },
    });

    await assertFails(createPayment());
  });

  it("rejects mismatched document and embedded IDs", async () => {
    await seedApprovedOrder("order-1", {
      request: { orderId: "different-order" },
    });

    await assertFails(createPayment());
    await assertFails(
      createPayment(makePayment("different-order")),
    );
  });

  it("rejects a payment method that does not match the selection", async () => {
    await seedApprovedOrder();

    await assertFails(
      createPayment(makePayment("order-1", "customer-1", {
        method: "cash",
      })),
    );
  });

  it("rejects a payment timing that does not match the selection", async () => {
    await seedApprovedOrder();

    await assertFails(
      createPayment(makePayment("order-1", "customer-1", {
        timing: "pay_later",
      })),
    );
  });

  it("rejects invalid selection methods and timings", async () => {
    for (const [orderId, selection, payment] of [
      [
        "invalid-method",
        { method: "card" },
        { method: "card" },
      ],
      [
        "invalid-timing",
        { timing: "later" },
        { timing: "later" },
      ],
    ]) {
      await seedApprovedOrder(orderId, { selection });
      await assertFails(
        createPayment(makePayment(orderId, "customer-1", payment)),
      );
    }
  });

  it("rejects an incorrect amount due", async () => {
    await seedApprovedOrder();

    await assertFails(
      createPayment(makePayment("order-1", "customer-1", {
        amountDueMinor: 12344,
      })),
    );
  });

  it("rejects paid or otherwise invalid initial status", async () => {
    await seedApprovedOrder();

    await assertFails(
      createPayment(makePayment("order-1", "customer-1", {
        status: "paid",
      })),
    );
    await assertFails(
      createPayment(makePayment("order-1", "customer-1", {
        status: "pending",
      })),
    );
  });

  it("rejects unexpected fields", async () => {
    await seedApprovedOrder();

    await assertFails(
      createPayment(makePayment("order-1", "customer-1", {
        cardNumber: "4111111111111111",
      })),
    );
  });

  it("rejects nonzero received or refunded amounts at initialization", async () => {
    await seedApprovedOrder();

    await assertFails(
      createPayment(makePayment("order-1", "customer-1", {
        amountReceivedMinor: 1,
      })),
    );
    await assertFails(
      createPayment(makePayment("order-1", "customer-1", {
        amountRefundedMinor: 1,
      })),
    );
  });

  it("denies all client updates and deletes", async () => {
    await seedApprovedOrder();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "orderPayments/order-1"),
        makePayment("order-1"),
      );
    });
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(
      updateDoc(doc(adminDb, "orderPayments/order-1"), {
        status: "paid",
      }),
    );
    await assertFails(
      updateDoc(doc(customerDb, "orderPayments/order-1"), {
        status: "paid",
      }),
    );
    await assertFails(deleteDoc(doc(adminDb, "orderPayments/order-1")));
    await assertFails(deleteDoc(doc(customerDb, "orderPayments/order-1")));
  });

  it("rejects duplicate creation of an existing payment summary", async () => {
    await seedApprovedOrder();
    await assertSucceeds(createPayment());

    await assertFails(
      createPayment(makePayment("order-1", "customer-1", {
        amountDueMinor: 99999,
      })),
    );

    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const summary = await getDoc(doc(adminDb, "orderPayments/order-1"));
    assert.equal(summary.data().amountDueMinor, 12345);
  });
});
