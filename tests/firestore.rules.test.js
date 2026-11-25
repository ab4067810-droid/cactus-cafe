import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";
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
  setDoc,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { approveOrderRequest } from "../src/services/orderApprovalService.js";
import { isPhoneBlocked } from "../src/services/blockedPhoneService.js";
import { getApprovalPricing } from "../src/utils/approvalPricing.js";

const projectId = "demo-cactus-cafe-rules";
const directCheckoutProjectId = "demo-cactus-cafe-direct-checkout-rules";
const rules = readFileSync(
  new URL("../firestore.rules", import.meta.url),
  "utf8",
);
const prototypeRules = readFileSync(
  new URL(
    process.env.FIRESTORE_PROTOTYPE_RULES
      || "../firestore.rules.prototype",
    import.meta.url,
  ),
  "utf8",
);

let testEnv;
let directCheckoutTestEnv;

function makeRequest(overrides = {}) {
  const request = {
    customerId: "customer-1",
    customerEmail: "customer@example.test",
    customerName: "Cafe Customer",
    phone: "09123456789",
    items: [{ id: "coffee", quantity: 2 }],
    orderType: "takeout",
    address: "12 Main Street, Barangay 1 (Poblacion), Isabela, Negros Occidental",
    notes: "Oat milk",
    status: "pending",
    createdAt: serverTimestamp(),
    ...overrides,
  };
  if (request.orderType === "delivery") {
    request.deliveryBarangay ??= "Barangay 1 Poblacion";
    request.deliveryFee ??= 20;
  }
  return request;
}

function makeOrder(request = makeRequest(), overrides = {}) {
  const items = request.items.map(({ id, quantity }) => ({
    id,
    name: id === "coffee" ? "Coffee" : "Menu item",
    price: 4,
    quantity,
    subtotal: 4 * quantity,
  }));
  const itemsSubtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  return {
    requestId: "request-1",
    customerId: request.customerId,
    customerEmail: request.customerEmail,
    customerName: request.customerName,
    phone: request.phone,
    orderType: request.orderType,
    address: request.address,
    ...(request.orderType === "delivery"
      ? {
        deliveryBarangay: request.deliveryBarangay,
        deliveryFee: request.deliveryFee,
        itemsSubtotal,
      }
      : {}),
    ...(Object.hasOwn(request, "deliveryLocation")
      ? { deliveryLocation: request.deliveryLocation }
      : {}),
    notes: request.notes,
    items,
    total: itemsSubtotal + (
      request.orderType === "delivery" ? request.deliveryFee : 0
    ),
    paymentMethod: "cash",
    paymentTiming: "pay_later",
    cashPaymentStatus: "unpaid",
    status: "Pending",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

function makePrototypeOrder(request = makeRequest(), overrides = {}) {
  return {
    requestId: "request-1",
    customerId: request.customerId,
    customerEmail: request.customerEmail,
    customerName: request.customerName,
    phone: request.phone,
    orderType: request.orderType,
    address: request.address,
    notes: request.notes,
    items: request.items.map(({ id, quantity }) => ({
      id,
      name: id === "coffee" ? "Coffee" : "Menu item",
      price: 4,
      quantity,
      subtotal: 4 * quantity,
    })),
    total: request.items.reduce((sum, item) => sum + 4 * item.quantity, 0),
    status: "Pending",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

function makeReservation(userId, overrides = {}) {
  return {
    userId,
    customerEmail: `${userId}@example.test`,
    customerName: "Cafe Customer",
    phone: "09123456789",
    date: "2026-12-01",
    time: "18:00",
    guests: 2,
    notes: "",
    status: "Pending",
    createdAt: serverTimestamp(),
    perHeadRate: 50,
    totalReservationFee: 100,
    selectedPaymentOption: "half",
    amountPaidNow: 50,
    remainingBalance: 50,
    paymentMethod: "qr",
    paymentReference: "TESTREF001",
    paymentProofUrl: "data:image/jpeg;base64,/9j/2Q==",
    paymentStatus: "pending_review",
    ...overrides,
  };
}

function makePaymentReferenceClaim(
  normalizedReference,
  createdBy = "customer-1",
  sourceType = "reservation",
) {
  return {
    normalizedReference,
    sourceType,
    createdBy,
    createdAt: serverTimestamp(),
  };
}

async function createReservationWithReference(
  database,
  reservationId,
  reservation,
  createdBy = "customer-1",
) {
  const batch = writeBatch(database);
  batch.set(
    doc(database, `paymentReferences/${reservation.paymentReference}`),
    makePaymentReferenceClaim(reservation.paymentReference, createdBy),
  );
  batch.set(doc(database, `reservations/${reservationId}`), reservation);
  await batch.commit();
}

function makeNotification(userId = "customer-1", overrides = {}) {
  return {
    userId,
    type: "order",
    itemId: "order-1",
    title: "Order approved",
    message: "Your order request has been approved.",
    isRead: false,
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedPendingRequest(requestId = "request-1", request = makeRequest()) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, `orderRequests/${requestId}`), request),
      setDoc(doc(firestore, `paymentSelections/${requestId}`), {
        requestId,
        customerId: request.customerId,
        method: "cash",
        timing: "pay_later",
      }),
    ]);
  });
}

async function seedApprovalState(menuItems = {
  coffee: {
    name: "Coffee",
    price: 4,
    available: true,
    menuRevision: 1,
  },
}) {
  const now = Timestamp.fromMillis(1000);
  const entries = Object.entries(menuItems);
  const prices = Object.fromEntries(
    entries.map(([id, menuItem]) => [
      id,
      {
        priceCents: Math.round(menuItem.price * 100),
        available: menuItem.available,
        menuRevision: menuItem.menuRevision,
      },
    ]),
  );

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      ...entries.map(([id, menuItem]) => (
        setDoc(doc(db, `menuItems/${id}`), menuItem)
      )),
      setDoc(doc(db, "menuControl/migration"), {
        state: "ready",
        startedAt: now,
        updatedAt: now,
        updatedBy: "admin-1",
      }),
      setDoc(doc(db, "menuControl/current"), {
        revision: 1,
        updatedAt: now,
        lastChangedMenuItemId: entries[0]?.[0] || "seed",
        prices,
      }),
    ]);
  });
}

function makeEmbeddedApproval(requestId, request = makeRequest(), overrides = {}) {
  const items = request.items.map(({ id, quantity }) => ({
    id,
    name: id === "coffee" ? "Coffee" : "Menu item",
    price: 4,
    quantity,
    subtotal: 4 * quantity,
  }));
  const total = items.reduce((sum, item) => sum + item.subtotal, 0);

  return {
    status: "approved",
    orderId: requestId,
    reviewedAt: serverTimestamp(),
    reviewedBy: "admin-1",
    approvedOrder: {
      items,
      total,
      createdAt: serverTimestamp(),
    },
    orderStatus: "Pending",
    ...overrides,
  };
}

function makeApprovedRequest(requestId, request = makeRequest()) {
  return {
    ...request,
    ...makeEmbeddedApproval(requestId, request),
  };
}

async function seedApprovedRequest(
  requestId,
  request = makeRequest(),
) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), `orderRequests/${requestId}`),
      makeApprovedRequest(requestId, request),
    );
  });
}

async function approveOrder(db, requestId = "request-1", request = makeRequest(), order = makeOrder(request, { requestId })) {
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

async function assertDeniedWithoutRuleEvaluationError(operation) {
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
    /maximum of 1000 expressions|unable to evaluate the expression|internal error/i,
  );
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
      setDoc(doc(db, "users/customer-1"), {
        role: "customer",
        email: "customer@example.test",
      }),
      setDoc(doc(db, "users/customer-2"), {
        role: "customer",
        email: "other@example.test",
      }),
      setDoc(doc(db, "users/admin-1"), {
        role: "admin",
        email: "admin@example.test",
      }),
      setDoc(doc(db, "users/staff-1"), {
        role: "staff",
        email: "staff@example.test",
      }),
      setDoc(doc(db, "menuItems/coffee"), { name: "Coffee", price: 4 }),
      setDoc(doc(db, "orders/order-1"), {
        customerId: "customer-1",
        status: "Pending",
        total: 12,
      }),
      setDoc(doc(db, "orders/order-2"), {
        customerId: "customer-2",
        status: "Pending",
        total: 5,
      }),
    ]);
  });
});

describe("user access", () => {
  it("allows customers to read their own profile but not another customer's", async () => {
    const db = testEnv.authenticatedContext("customer-1").firestore();

    await assertSucceeds(getDoc(doc(db, "users/customer-1")));
    await assertFails(getDoc(doc(db, "users/customer-2")));
  });

  it("prevents customers from promoting themselves to admin", async () => {
    const db = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(
      updateDoc(doc(db, "users/customer-1"), { role: "admin" }),
    );
  });

  it("preserves access for legacy administrators with only the isAdmin flag", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users/legacy-admin"), {
        isAdmin: true,
      });
    });

    const db = testEnv.authenticatedContext("legacy-admin").firestore();
    await assertSucceeds(getDoc(doc(db, "users/customer-1")));
    await assertSucceeds(getDocs(collection(db, "users")));
    await assertSucceeds(getDocs(collection(db, "orders")));
  });
});

describe("customer notifications", () => {
  it("allows admins and staff to create only valid notifications", async () => {
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const staffDb = testEnv.authenticatedContext("staff-1").firestore();
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();

    await assertSucceeds(
      setDoc(
        doc(adminDb, "notifications/valid-notification"),
        makeNotification(),
      ),
    );
    await assertSucceeds(
      setDoc(
        doc(staffDb, "notifications/staff-created"),
        makeNotification(),
      ),
    );
    await assertFails(
      setDoc(
        doc(customerDb, "notifications/customer-created"),
        makeNotification(),
      ),
    );
    await assertFails(
      setDoc(
        doc(adminDb, "notifications/invalid-type"),
        makeNotification("customer-1", { type: "payment" }),
      ),
    );
    await assertFails(
      setDoc(
        doc(adminDb, "notifications/extra-field"),
        makeNotification("customer-1", { extra: true }),
      ),
    );
  });

  it("limits notification reads and lists to the owning customer", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(
          doc(db, "notifications/customer-notification"),
          makeNotification("customer-1", {
            createdAt: Timestamp.fromMillis(1000),
          }),
        ),
        setDoc(
          doc(db, "notifications/other-notification"),
          makeNotification("customer-2", {
            createdAt: Timestamp.fromMillis(2000),
          }),
        ),
      ]);
    });

    const ownerDb = testEnv.authenticatedContext("customer-1").firestore();
    const otherDb = testEnv.authenticatedContext("customer-2").firestore();
    const ownerNotifications = query(
      collection(ownerDb, "notifications"),
      where("userId", "==", "customer-1"),
    );

    await assertSucceeds(
      getDoc(doc(ownerDb, "notifications/customer-notification")),
    );
    await assertFails(
      getDoc(doc(ownerDb, "notifications/other-notification")),
    );
    assert.equal((await assertSucceeds(getDocs(ownerNotifications))).size, 1);
    await assertFails(getDocs(collection(ownerDb, "notifications")));
    await assertFails(
      getDoc(doc(otherDb, "notifications/customer-notification")),
    );
  });

  it("allows owners to update only isRead and denies deletes", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "notifications/customer-notification"),
        makeNotification("customer-1", {
          createdAt: Timestamp.fromMillis(1000),
        }),
      );
    });

    const ownerDb = testEnv.authenticatedContext("customer-1").firestore();
    const otherDb = testEnv.authenticatedContext("customer-2").firestore();
    const notificationRef = doc(ownerDb, "notifications/customer-notification");

    await assertSucceeds(updateDoc(notificationRef, { isRead: true }));
    await assertFails(
      updateDoc(notificationRef, { title: "Changed title" }),
    );
    await assertFails(
      updateDoc(
        doc(otherDb, "notifications/customer-notification"),
        { isRead: true },
      ),
    );
    await assertFails(deleteDoc(notificationRef));
  });
});

describe("customer favorites access", () => {
  it("allows owners to read and write favorites but blocks other users", async () => {
    const ownerDb = testEnv.authenticatedContext("customer-1").firestore();
    const otherDb = testEnv.authenticatedContext("customer-2").firestore();
    const favoriteRef = doc(ownerDb, "users/customer-1/favorites/coffee");

    await assertSucceeds(
      setDoc(
        favoriteRef,
        { itemId: "coffee", updatedAt: serverTimestamp() },
        { merge: true },
      ),
    );
    await assertSucceeds(
      setDoc(
        favoriteRef,
        { itemId: "coffee", updatedAt: serverTimestamp() },
        { merge: true },
      ),
    );
    await assertSucceeds(getDoc(favoriteRef));
    await assertSucceeds(
      getDocs(collection(ownerDb, "users/customer-1/favorites")),
    );
    await assertSucceeds(
      updateDoc(favoriteRef, { updatedAt: serverTimestamp() }),
    );
    await assertFails(
      getDoc(doc(otherDb, "users/customer-1/favorites/coffee")),
    );
    await assertFails(
      getDocs(collection(otherDb, "users/customer-1/favorites")),
    );
    await assertFails(
      setDoc(
        doc(otherDb, "users/customer-1/favorites/coffee"),
        { itemId: "coffee", updatedAt: serverTimestamp() },
        { merge: true },
      ),
    );
    await assertFails(
      deleteDoc(doc(otherDb, "users/customer-1/favorites/coffee")),
    );
    await assertSucceeds(deleteDoc(favoriteRef));
  });
});

describe("menu access", () => {
  it("allows public reads while limiting writes to admins and staff", async () => {
    const visitorDb = testEnv.unauthenticatedContext().firestore();
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "menuControl/migration"), {
        state: "ready",
        startedAt: Timestamp.fromMillis(1000),
        updatedAt: Timestamp.fromMillis(1000),
        updatedBy: "admin-1",
      });
    });

    const createTea = async (database) => {
      const batch = writeBatch(database);
      batch.set(doc(database, "menuItems/new-item"), {
        name: "Tea",
        price: 3,
        available: true,
        menuRevision: 1,
      });
      batch.set(doc(database, "menuControl/current"), {
        revision: 1,
        updatedAt: serverTimestamp(),
        lastChangedMenuItemId: "new-item",
        prices: {
          "new-item": {
            priceCents: 300,
            available: true,
            menuRevision: 1,
          },
        },
      });
      await batch.commit();
    };

    await assertSucceeds(getDoc(doc(visitorDb, "menuItems/coffee")));
    await assertFails(createTea(customerDb));
    await assertSucceeds(createTea(adminDb));
  });

  it("allows staff to create a menu item with its paired price book", async () => {
    const staffDb = testEnv.authenticatedContext("staff-1").firestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "menuControl/migration"), {
        state: "ready",
        startedAt: Timestamp.fromMillis(1000),
        updatedAt: Timestamp.fromMillis(1000),
        updatedBy: "admin-1",
      });
    });

    const staffBatch = writeBatch(staffDb);
    staffBatch.set(doc(staffDb, "menuItems/staff-item"), {
      name: "Staff Tea",
      price: 3,
      available: true,
      menuRevision: 1,
    });
    staffBatch.set(doc(staffDb, "menuControl/current"), {
      revision: 1,
      updatedAt: serverTimestamp(),
      lastChangedMenuItemId: "staff-item",
      prices: {
        "staff-item": {
          priceCents: 300,
          available: true,
          menuRevision: 1,
        },
      },
    });
    await assertSucceeds(staffBatch.commit());
  });
});

describe("payment reference registry", () => {
  it("allows signed-in single-document gets but denies customer collection lists", async () => {
    const ownerDb = testEnv.authenticatedContext("customer-1").firestore();
    const otherDb = testEnv.authenticatedContext("customer-2").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const reference = "1234567890123";

    await assertSucceeds(
      setDoc(
        doc(ownerDb, `paymentReferences/${reference}`),
        makePaymentReferenceClaim(reference),
      ),
    );
    await assertSucceeds(
      getDoc(doc(ownerDb, `paymentReferences/${reference}`)),
    );
    await assertSucceeds(
      getDoc(doc(otherDb, `paymentReferences/${reference}`)),
    );
    await assertFails(getDocs(collection(ownerDb, "paymentReferences")));
    await assertSucceeds(getDocs(collection(adminDb, "paymentReferences")));
  });

  it("rejects duplicate claims, customer overwrites, and PII fields", async () => {
    const ownerDb = testEnv.authenticatedContext("customer-1").firestore();
    const otherDb = testEnv.authenticatedContext("customer-2").firestore();
    const reference = "1234567890123";
    const referenceRef = doc(ownerDb, `paymentReferences/${reference}`);

    await assertSucceeds(
      setDoc(referenceRef, makePaymentReferenceClaim(reference)),
    );
    await assertFails(
      setDoc(
        doc(otherDb, `paymentReferences/${reference}`),
        makePaymentReferenceClaim(reference, "customer-2"),
      ),
    );
    await assertFails(
      setDoc(referenceRef, makePaymentReferenceClaim(reference)),
    );
    await assertFails(
      updateDoc(referenceRef, { sourceType: "reservation" }),
    );
    await assertFails(deleteDoc(referenceRef));
    await assertFails(
      setDoc(
        doc(ownerDb, "paymentReferences/1234567890124"),
        {
          ...makePaymentReferenceClaim("1234567890124"),
          customerEmail: "customer@example.test",
        },
      ),
    );
  });
});

describe("order access", () => {
  it("allows customers to read only their own orders", async () => {
    const ownerDb = testEnv.authenticatedContext("customer-1").firestore();
    const otherDb = testEnv.authenticatedContext("customer-2").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const staffDb = testEnv.authenticatedContext("staff-1").firestore();

    await assertSucceeds(getDoc(doc(ownerDb, "orders/order-1")));
    await assertFails(getDoc(doc(otherDb, "orders/order-1")));
    await assertSucceeds(getDoc(doc(adminDb, "orders/order-1")));
    await assertSucceeds(getDoc(doc(staffDb, "orders/order-1")));
    const adminOrders = await getDocs(collection(adminDb, "orders"));
    if (adminOrders.size !== 2) {
      throw new Error("Administrator could not list all seeded orders");
    }
    const staffOrders = await getDocs(collection(staffDb, "orders"));
    if (staffOrders.size !== 2) {
      throw new Error("Staff could not list operational orders");
    }
  });

  it("denies direct order creation so checkout writes remain behind the callable workflow", async () => {
    const db = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(
      setDoc(doc(db, "orders/client-created"), {
        customerId: "customer-1",
        status: "Pending",
        total: 12,
      }),
    );
  });

  it("allows admins to change only an order's status to an approved value", async () => {
    const db = testEnv.authenticatedContext("admin-1").firestore();
    const staffDb = testEnv.authenticatedContext("staff-1").firestore();
    const customerDb = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();

    await assertSucceeds(
      updateDoc(doc(db, "orders/order-1"), { status: "Confirmed" }),
    );
    await assertSucceeds(
      updateDoc(doc(staffDb, "orders/order-2"), { status: "Confirmed" }),
    );
    await assertFails(
      updateDoc(doc(db, "orders/order-1"), { total: 99 }),
    );
    await assertFails(
      updateDoc(doc(db, "orders/order-1"), { status: "Refunded" }),
    );
    await assertFails(
      updateDoc(doc(customerDb, "orders/order-1"), { status: "Confirmed" }),
    );
  });
});

describe("admin-reviewed order request workflow", () => {
  it("denies anonymous customer submissions", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, "orderRequests/anonymous-request"), makeRequest()),
    );
  });

  it("allows authenticated customers to create their own pending request", async () => {
    const db = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    await assertSucceeds(
      setDoc(doc(db, "orderRequests/customer-request"), makeRequest()),
    );
  });

  it("allows admins to reject pending requests with review metadata", async () => {
    const requestId = "admin-rejected-request";
    await seedPendingRequest(requestId);
    const db = testEnv.authenticatedContext("admin-1").firestore();

    await assertSucceeds(
      updateDoc(doc(db, `orderRequests/${requestId}`), {
        status: "rejected",
        reviewedAt: serverTimestamp(),
        reviewedBy: "admin-1",
        rejectionReason: "One or more requested items are unavailable.",
      }),
    );

    const rejectedRequest = await getDoc(doc(db, `orderRequests/${requestId}`));
    assert.equal(rejectedRequest.data().status, "rejected");
    assert.equal(
      rejectedRequest.data().rejectionReason,
      "One or more requested items are unavailable.",
    );
    assert.equal(rejectedRequest.data().reviewedBy, "admin-1");
    assert.ok(rejectedRequest.data().reviewedAt instanceof Timestamp);
  });

  it("allows staff to reject pending operational requests", async () => {
    const requestId = "staff-rejected-request";
    await seedPendingRequest(requestId);
    const db = testEnv.authenticatedContext("staff-1").firestore();

    await assertSucceeds(
      updateDoc(doc(db, `orderRequests/${requestId}`), {
        status: "rejected",
        reviewedAt: serverTimestamp(),
        reviewedBy: "staff-1",
        rejectionReason: "The requested item is unavailable.",
      }),
    );
  });

  it("denies customer, incomplete, and malformed request rejections", async () => {
    const requestId = "protected-rejection-request";
    await seedPendingRequest(requestId);
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const rejection = {
      status: "rejected",
      reviewedAt: serverTimestamp(),
      reviewedBy: "admin-1",
      rejectionReason: "The requested items are unavailable.",
    };

    await assertFails(
      updateDoc(doc(customerDb, `orderRequests/${requestId}`), rejection),
    );
    await assertFails(
      updateDoc(doc(adminDb, `orderRequests/${requestId}`), {
        status: "rejected",
      }),
    );
    await assertFails(
      updateDoc(doc(adminDb, `orderRequests/${requestId}`), {
        ...rejection,
        rejectionReason: "",
      }),
    );
    await assertFails(
      updateDoc(doc(adminDb, `orderRequests/${requestId}`), {
        ...rejection,
        customerId: "customer-2",
      }),
    );
  });

  it("accepts supported drink sizes and rejects unsupported request sizes", async () => {
    const db = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    await assertSucceeds(
      setDoc(
        doc(db, "orderRequests/sized-request"),
        makeRequest({
          items: [{ id: "soda", quantity: 1, size: "12oz" }],
        }),
      ),
    );

    await assertFails(
      setDoc(
        doc(db, "orderRequests/unsupported-size-request"),
        makeRequest({
          items: [{ id: "soda", quantity: 1, size: "20oz" }],
        }),
      ),
    );
  });

  it("rejects a customer request with a missing required field", async () => {
    const db = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    const request = makeRequest();
    delete request.customerName;

    await assertFails(
      setDoc(doc(db, "orderRequests/missing-required-field"), request),
    );
  });

  it("rejects a customer request with duplicate item IDs", async () => {
    const db = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();

    await assertFails(
      setDoc(
        doc(db, "orderRequests/duplicate-item-ids"),
        makeRequest({
          items: [
            { id: "coffee", quantity: 1 },
            { id: "coffee", quantity: 2 },
          ],
        }),
      ),
    );
  });

  it("rejects a request containing another user's UID", async () => {
    const db = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    await assertFails(
      setDoc(
        doc(db, "orderRequests/forged-owner"),
        makeRequest({ customerId: "customer-2" }),
      ),
    );
  });

  it("rejects customer-supplied prices, subtotals, and totals", async () => {
    const db = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    for (const [index, field] of ["price", "subtotal", "total"].entries()) {
      await assertFails(
        setDoc(
          doc(db, `orderRequests/forged-price-${index}`),
          makeRequest({ [field]: 0 }),
        ),
      );
    }
  });

  it("rejects unexpected and administrator-controlled request fields", async () => {
    const db = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    const forbiddenFields = [
      { orderId: "forged-order" },
      { reviewedAt: Timestamp.now() },
      { reviewedBy: "admin-1" },
      { rejectionReason: "not rejected" },
      { isAdmin: true },
      { unexpected: "value" },
    ];

    for (const [index, field] of forbiddenFields.entries()) {
      await assertFails(
        setDoc(
          doc(db, `orderRequests/unexpected-${index}`),
          makeRequest(field),
        ),
      );
    }
  });

  it("validates request fields, order types, address rules, and item count", async () => {
    const db = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    await assertSucceeds(
      setDoc(
        doc(db, "orderRequests/delivery-request"),
        makeRequest({ orderType: "delivery", address: "123 Main Street" }),
      ),
    );
    await assertSucceeds(
      setDoc(
        doc(db, "orderRequests/dine-in-request"),
        makeRequest({ orderType: "dine-in" }),
      ),
    );
    await assertSucceeds(
      setDoc(
        doc(db, "orderRequests/takeout-request"),
        makeRequest({ orderType: "takeout" }),
      ),
    );
    await assertSucceeds(
      setDoc(
        doc(db, "orderRequests/ten-item-request"),
        makeRequest({
          orderType: "delivery",
          address: "123 Main Street",
          items: Array.from({ length: 10 }, (_, index) => ({
            id: `item-${index}`,
            quantity: 1,
          })),
        }),
      ),
    );

    const invalidRequests = [
      { customerName: "" },
      { customerName: "x".repeat(121) },
      { phone: 123 },
      { phone: "x".repeat(41) },
      { customerEmail: "other@example.test" },
      { orderType: "pickup" },
      { orderType: "delivery", address: "" },
      { orderType: "takeout", address: "" },
      { orderType: "dine-in", address: "" },
      { address: "x".repeat(501) },
      { notes: "x".repeat(1001) },
      { status: "approved" },
      { items: [] },
      { items: Array.from({ length: 11 }, (_, index) => ({ id: `item-${index}`, quantity: 1 })) },
    ];

    for (const [index, overrides] of invalidRequests.entries()) {
      await assertFails(
        setDoc(
          doc(db, `orderRequests/invalid-fields-${index}`),
          makeRequest(overrides),
        ),
      );
    }
  });

  it("rejects invalid quantities, malformed item maps, and invalid item IDs", async () => {
    const db = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    const invalidItems = [
      [{ id: "coffee", quantity: 0 }],
      [{ id: "coffee", quantity: 100 }],
      [{ id: "coffee", quantity: 1.5 }],
      [{ id: "coffee", quantity: "2" }],
      [{ id: "coffee", quantity: 2, price: 4 }],
      [{ id: "coffee", name: "Coffee", quantity: 2 }],
      [{ id: "", quantity: 1 }],
      [{ id: "menu/coffee", quantity: 1 }],
      [{ id: "x".repeat(1501), quantity: 1 }],
    ];

    for (const [index, items] of invalidItems.entries()) {
      await assertFails(
        setDoc(
          doc(db, `orderRequests/invalid-item-${index}`),
          makeRequest({ items }),
        ),
      );
    }
  });

  it("prevents customers from modifying or deleting submitted requests", async () => {
    const db = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    const requestId = "immutable-request";
    await setDoc(doc(db, `orderRequests/${requestId}`), makeRequest());

    await assertFails(
      updateDoc(doc(db, `orderRequests/${requestId}`), { notes: "changed" }),
    );
    await assertFails(deleteDoc(doc(db, `orderRequests/${requestId}`)));
  });

  it("prevents customers from approving their own requests", async () => {
    const requestId = "customer-approval";
    const request = makeRequest();
    await seedPendingRequest(requestId, request);
    const db = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    const batch = writeBatch(db);
    batch.update(doc(db, `orderRequests/${requestId}`), {
      status: "approved",
      orderId: requestId,
      reviewedAt: serverTimestamp(),
      reviewedBy: "customer-1",
    });
    batch.set(
      doc(db, `orders/${requestId}`),
      makeOrder(request, { requestId }),
    );
    await assertFails(batch.commit());
  });

  it("prevents non-admins from approving requests", async () => {
    const requestId = "non-admin-approval";
    const request = makeRequest();
    await seedPendingRequest(requestId, request);
    const db = testEnv
      .authenticatedContext("customer-2", { email: "other@example.test" })
      .firestore();
    const batch = writeBatch(db);
    batch.update(doc(db, `orderRequests/${requestId}`), {
      status: "approved",
      orderId: requestId,
      reviewedAt: serverTimestamp(),
      reviewedBy: "customer-2",
    });
    batch.set(
      doc(db, `orders/${requestId}`),
      makeOrder(request, { requestId }),
    );
    await assertFails(batch.commit());
  });

  it("denies direct administrator approval and order creation", async () => {
    const requestId = "approved-request";
    const request = makeRequest();
    await seedPendingRequest(requestId, request);
    const db = testEnv.authenticatedContext("admin-1").firestore();

    await assertFails(
      updateDoc(
        doc(db, `orderRequests/${requestId}`),
        makeEmbeddedApproval(requestId, request),
      ),
    );
    await assertFails(
      setDoc(
        doc(db, `orders/${requestId}`),
        makeOrder(request, { requestId }),
      ),
    );
    const pendingRequest = await getDoc(doc(db, `orderRequests/${requestId}`));
    const officialOrder = await getDoc(doc(db, `orders/${requestId}`));
    assert.equal(pendingRequest.data().status, "pending");
    assert.equal(officialOrder.exists(), false);
  });

  it("approves a request through the approval service atomically", async () => {
    const requestId = "service-approved-request";
    const request = makeRequest();
    await seedApprovalState();
    await seedPendingRequest(requestId, request);
    const db = testEnv.authenticatedContext("admin-1").firestore();
    const confirmedPricing = getApprovalPricing(
      request,
      new Map([["coffee", { name: "Coffee", price: 4 }]])
    );

    const result = await approveOrderRequest(
      db,
      requestId,
      "admin-1",
      confirmedPricing
    );
    const approvedRequest = await getDoc(
      doc(db, `orderRequests/${requestId}`)
    );
    const officialOrder = await getDoc(doc(db, `orders/${requestId}`));

    assert.equal(result.error, undefined);
    assert.equal(approvedRequest.data().status, "approved");
    assert.equal(approvedRequest.data().orderId, requestId);
    assert.equal(approvedRequest.data().reviewedBy, "admin-1");
    assert.equal(officialOrder.exists(), true);
    assert.equal(officialOrder.data().total, confirmedPricing.total);
    assert.deepEqual(officialOrder.data().items, confirmedPricing.orderItems);
    assert.equal(officialOrder.data().customerName, request.customerName);
    assert.equal(officialOrder.data().phone, request.phone);
    assert.equal(officialOrder.data().orderType, request.orderType);
  });

  it("approves a maximum 10-item request through the approval service", async () => {
    const requestId = "service-approved-10-items";
    const items = Array.from({ length: 10 }, (_, index) => ({
      id: `menu-${index + 1}`,
      quantity: index + 1,
    }));
    const request = makeRequest({ items });
    const menuItems = Object.fromEntries(items.map((item, index) => [
      item.id,
      {
        name: `Menu Item ${index + 1}`,
        price: 4,
        available: true,
        menuRevision: 1,
      },
    ]));
    const menuMap = new Map(
      Object.entries(menuItems).map(([id, item]) => [
        id,
        { name: item.name, price: item.price, available: item.available },
      ]),
    );

    await seedApprovalState(menuItems);
    await seedPendingRequest(requestId, request);

    const db = testEnv.authenticatedContext("admin-1").firestore();
    const confirmedPricing = getApprovalPricing(request, menuMap);
    const result = await approveOrderRequest(
      db,
      requestId,
      "admin-1",
      confirmedPricing,
    );
    const approvedRequest = await getDoc(
      doc(db, `orderRequests/${requestId}`),
    );
    const officialOrder = await getDoc(doc(db, `orders/${requestId}`));

    assert.equal(result.error, undefined);
    assert.equal(approvedRequest.data().status, "approved");
    assert.equal(officialOrder.exists(), true);
    assert.equal(officialOrder.data().items.length, 10);
    assert.equal(officialOrder.data().total, confirmedPricing.total);
  });

  it("rejects duplicate approval through the approval service", async () => {
    const requestId = "service-duplicate-approval";
    const request = makeRequest();
    await seedApprovalState();
    await seedPendingRequest(requestId, request);
    const db = testEnv.authenticatedContext("admin-1").firestore();
    const confirmedPricing = getApprovalPricing(
      request,
      new Map([["coffee", { name: "Coffee", price: 4 }]])
    );

    const firstResult = await approveOrderRequest(
      db,
      requestId,
      "admin-1",
      confirmedPricing
    );
    assert.equal(firstResult.error, undefined);

    const duplicateResult = await approveOrderRequest(
      db,
      requestId,
      "admin-1",
      confirmedPricing
    );
    const approvedRequest = await getDoc(
      doc(db, `orderRequests/${requestId}`)
    );
    const officialOrder = await getDoc(doc(db, `orders/${requestId}`));

    assert.match(duplicateResult.error?.message || "", /no longer pending/);
    assert.equal(approvedRequest.data().status, "approved");
    assert.equal(approvedRequest.data().orderId, requestId);
    assert.equal(approvedRequest.data().reviewedBy, "admin-1");
    assert.equal(officialOrder.exists(), true);
    assert.equal(officialOrder.data().total, confirmedPricing.total);
  });

  it("rejects approval when menu pricing changes after confirmation", async () => {
    const requestId = "service-stale-pricing";
    const request = makeRequest();
    await seedApprovalState();
    await seedPendingRequest(requestId, request);
    const db = testEnv.authenticatedContext("admin-1").firestore();
    const confirmedPricing = getApprovalPricing(
      request,
      new Map([["coffee", { name: "Coffee", price: 4 }]])
    );
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      const now = Timestamp.fromMillis(2000);
      await Promise.all([
        setDoc(doc(database, "menuItems/coffee"), {
          name: "Coffee",
          price: 5,
          available: true,
          menuRevision: 2,
        }),
        setDoc(doc(database, "menuControl/current"), {
          revision: 2,
          updatedAt: now,
          lastChangedMenuItemId: "coffee",
          prices: {
            coffee: {
              priceCents: 500,
              available: true,
              menuRevision: 2,
            },
          },
        }),
      ]);
    });

    const result = await approveOrderRequest(
      db,
      requestId,
      "admin-1",
      confirmedPricing
    );
    const pendingRequest = await getDoc(
      doc(db, `orderRequests/${requestId}`)
    );
    const officialOrder = await getDoc(doc(db, `orders/${requestId}`));

    assert.match(result.error?.message || "", /prices or item details changed/);
    assert.equal(pendingRequest.data().status, "pending");
    assert.equal(pendingRequest.data().orderId, undefined);
    assert.equal(officialOrder.exists(), false);
  });

  it("keeps request and order unchanged when the approval commit fails", async () => {
    const requestId = "service-failed-commit";
    const request = makeRequest();
    await seedApprovalState();
    await seedPendingRequest(requestId, request);
    const db = testEnv.authenticatedContext("admin-1").firestore();
    const confirmedPricing = getApprovalPricing(
      request,
      new Map([["coffee", { name: "Coffee", price: 4 }]])
    );

    const result = await approveOrderRequest(
      db,
      requestId,
      "different-admin",
      confirmedPricing
    );
    const pendingRequest = await getDoc(
      doc(db, `orderRequests/${requestId}`)
    );
    const officialOrder = await getDoc(doc(db, `orders/${requestId}`));

    assert.ok(result.error);
    assert.equal(pendingRequest.data().status, "pending");
    assert.equal(pendingRequest.data().orderId, undefined);
    assert.equal(officialOrder.exists(), false);
  });

  it("denies approval while migrating, finalizing, or without migration control", async () => {
    for (const migrationState of ["migrating", "finalizing", null]) {
      const requestId = `service-not-ready-${migrationState || "missing"}`;
      const request = makeRequest();
      await seedApprovalState();
      await seedPendingRequest(requestId, request);
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const migrationRef = doc(
          context.firestore(),
          "menuControl/migration",
        );
        if (migrationState === null) {
          await deleteDoc(migrationRef);
          return;
        }
        await updateDoc(migrationRef, { state: migrationState });
      });

      const db = testEnv.authenticatedContext("admin-1").firestore();
      const order = makeOrder(request, { requestId });
      const result = await approveOrderRequest(
        db,
        requestId,
        "admin-1",
        getApprovalPricing(
          request,
          new Map([["coffee", { name: "Coffee", price: 4 }]]),
        ),
      );

      assert.equal(result.error.code, "failed-precondition");
      await assertFails(approveOrder(db, requestId, request, order));
      assert.equal(
        (await getDoc(doc(db, `orderRequests/${requestId}`))).data().status,
        "pending",
      );
      assert.equal(
        (await getDoc(doc(db, `orders/${requestId}`))).exists(),
        false,
      );
    }
  });

  it("denies missing or price-book-mismatched order snapshots atomically", async () => {
    const missingBookId = "service-missing-price-book";
    const missingBookRequest = makeRequest();
    await seedApprovalState();
    await seedPendingRequest(missingBookId, missingBookRequest);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), "menuControl/current"));
    });
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const missingBookResult = await approveOrderRequest(
      adminDb,
      missingBookId,
      "admin-1",
      getApprovalPricing(
        missingBookRequest,
        new Map([["coffee", { name: "Coffee", price: 4 }]]),
      ),
    );
    assert.equal(missingBookResult.error.code, "failed-precondition");
    await assertFails(approveOrder(
      adminDb,
      missingBookId,
      missingBookRequest,
      makeOrder(missingBookRequest, { requestId: missingBookId }),
    ));
    assert.equal(
      (await getDoc(doc(adminDb, `orderRequests/${missingBookId}`))).data().status,
      "pending",
    );
    assert.equal(
      (await getDoc(doc(adminDb, `orders/${missingBookId}`))).exists(),
      false,
    );

    const mismatchedBookId = "service-mismatched-price-book";
    const mismatchedRequest = makeRequest();
    await seedApprovalState();
    await seedPendingRequest(mismatchedBookId, mismatchedRequest);
    const mismatchedOrder = makeOrder(mismatchedRequest, {
      requestId: mismatchedBookId,
      items: [{
        id: "coffee",
        name: "Coffee",
        price: 5,
        quantity: 2,
        subtotal: 10,
      }],
      total: 10,
    });
    await assertFails(approveOrder(
      adminDb,
      mismatchedBookId,
      mismatchedRequest,
      mismatchedOrder,
    ));
    assert.equal(
      (await getDoc(doc(adminDb, `orderRequests/${mismatchedBookId}`))).data().status,
      "pending",
    );
    assert.equal(
      (await getDoc(doc(adminDb, `orders/${mismatchedBookId}`))).exists(),
      false,
    );
  });

  it("denies approval with invalid order/request linkage", async () => {
    const requestId = "service-invalid-linkage";
    const request = makeRequest();
    await seedApprovalState();
    await seedPendingRequest(requestId, request);
    const db = testEnv.authenticatedContext("admin-1").firestore();
    const batch = writeBatch(db);
    batch.update(doc(db, `orderRequests/${requestId}`), {
      status: "approved",
      orderId: requestId,
      reviewedAt: serverTimestamp(),
      reviewedBy: "admin-1",
    });
    batch.set(
      doc(db, `orders/${requestId}`),
      makeOrder(request, {
        requestId,
        customerId: "customer-2",
      }),
    );

    await assertFails(batch.commit());
    assert.equal(
      (await getDoc(doc(db, `orderRequests/${requestId}`))).data().status,
      "pending",
    );
    assert.equal(
      (await getDoc(doc(db, `orders/${requestId}`))).exists(),
      false,
    );
  });

  it("allows only one of two concurrent approvals", async () => {
    const requestId = "service-concurrent-approval";
    const request = makeRequest();
    await seedApprovalState();
    await seedPendingRequest(requestId, request);
    const db = testEnv.authenticatedContext("admin-1").firestore();
    const confirmedPricing = getApprovalPricing(
      request,
      new Map([["coffee", { name: "Coffee", price: 4 }]]),
    );

    const results = await Promise.all([
      approveOrderRequest(db, requestId, "admin-1", confirmedPricing),
      approveOrderRequest(db, requestId, "admin-1", confirmedPricing),
    ]);

    assert.equal(results.filter((result) => !result.error).length, 1);
    assert.equal(
      results.filter((result) => result.error?.code === "failed-precondition").length,
      1,
    );
    assert.equal(
      (await getDoc(doc(db, `orderRequests/${requestId}`))).data().status,
      "approved",
    );
    assert.equal(
      (await getDoc(doc(db, `orders/${requestId}`))).exists(),
      true,
    );
  });

  it("reports a missing approval request", async () => {
    const db = testEnv.authenticatedContext("admin-1").firestore();
    const result = await approveOrderRequest(
      db,
      "missing-approval-request",
      "admin-1",
      {},
    );
    assert.equal(result.error.code, "not-found");
  });

  it("denies direct approval and order creation for fractional subtotals", async () => {
    const requestId = "fractional-subtotal-rounding";
    const request = makeRequest({
      items: [{ id: "coffee", quantity: 3 }],
    });
    const order = makeOrder(request, {
      requestId,
      items: [{
        id: "coffee",
        name: "Coffee",
        price: 0.1,
        quantity: 3,
        subtotal: 0.3,
      }],
      total: 0.3,
    });
    await seedPendingRequest(requestId, request);
    const db = testEnv.authenticatedContext("admin-1").firestore();

    await assertFails(
      updateDoc(
        doc(db, `orderRequests/${requestId}`),
        makeEmbeddedApproval(requestId, request),
      ),
    );
    await assertFails(setDoc(doc(db, `orders/${requestId}`), order));
    const pendingRequest = await getDoc(doc(db, `orderRequests/${requestId}`));
    const officialOrder = await getDoc(doc(db, `orders/${requestId}`));
    assert.equal(pendingRequest.data().status, "pending");
    assert.equal(officialOrder.exists(), false);
  });

  it("denies direct approval and order creation for fractional totals", async () => {
    const requestId = "fractional-total-rounding";
    const request = makeRequest({
      items: [
        { id: "coffee", quantity: 1 },
        { id: "tea", quantity: 1 },
      ],
    });
    const order = makeOrder(request, {
      requestId,
      items: [
        {
          id: "coffee",
          name: "Coffee",
          price: 0.1,
          quantity: 1,
          subtotal: 0.1,
        },
        {
          id: "tea",
          name: "Tea",
          price: 0.2,
          quantity: 1,
          subtotal: 0.2,
        },
      ],
      total: 0.3,
    });
    await seedPendingRequest(requestId, request);
    const db = testEnv.authenticatedContext("admin-1").firestore();

    await assertFails(
      updateDoc(
        doc(db, `orderRequests/${requestId}`),
        makeEmbeddedApproval(requestId, request),
      ),
    );
    await assertFails(setDoc(doc(db, `orders/${requestId}`), order));
    const pendingRequest = await getDoc(doc(db, `orderRequests/${requestId}`));
    const officialOrder = await getDoc(doc(db, `orders/${requestId}`));
    assert.equal(pendingRequest.data().status, "pending");
    assert.equal(officialOrder.exists(), false);
  });

  it("rejects a materially incorrect fractional item subtotal", async () => {
    const requestId = "fractional-bad-subtotal";
    const request = makeRequest({
      items: [{ id: "coffee", quantity: 3 }],
    });
    const order = makeOrder(request, {
      requestId,
      items: [{
        id: "coffee",
        name: "Coffee",
        price: 0.1,
        quantity: 3,
        subtotal: 0.31,
      }],
      total: 0.31,
    });
    await seedPendingRequest(requestId, request);
    const db = testEnv.authenticatedContext("admin-1").firestore();

    await assertFails(approveOrder(db, requestId, request, order));
  });

  it("rejects a materially incorrect fractional order total", async () => {
    const requestId = "fractional-bad-total";
    const request = makeRequest({
      items: [
        { id: "coffee", quantity: 1 },
        { id: "tea", quantity: 1 },
      ],
    });
    const order = makeOrder(request, {
      requestId,
      items: [
        {
          id: "coffee",
          name: "Coffee",
          price: 0.1,
          quantity: 1,
          subtotal: 0.1,
        },
        {
          id: "tea",
          name: "Tea",
          price: 0.2,
          quantity: 1,
          subtotal: 0.2,
        },
      ],
      total: 0.32,
    });
    await seedPendingRequest(requestId, request);
    const db = testEnv.authenticatedContext("admin-1").firestore();

    await assertFails(approveOrder(db, requestId, request, order));
  });

  it("rejects request approval unless a matching official order is created atomically", async () => {
    const requestId = "approval-without-order";
    await seedPendingRequest(requestId);
    const db = testEnv.authenticatedContext("admin-1").firestore();

    await assertFails(
      updateDoc(doc(db, `orderRequests/${requestId}`), {
        status: "approved",
        orderId: requestId,
        reviewedAt: serverTimestamp(),
        reviewedBy: "admin-1",
      }),
    );
  });

  it("rejects official order creation without request approval", async () => {
    const requestId = "order-without-approval";
    const request = makeRequest();
    await seedPendingRequest(requestId, request);
    const db = testEnv.authenticatedContext("admin-1").firestore();

    await assertFails(
      setDoc(
        doc(db, `orders/${requestId}`),
        makeOrder(request, { requestId }),
      ),
    );
  });

  it("rejects mismatched request IDs, order IDs, and customer IDs", async () => {
    const cases = [
      { requestId: "mismatched-order-id", order: { requestId: "other-id" } },
      { requestId: "mismatched-customer-id", order: { customerId: "customer-2" } },
      { requestId: "mismatched-document-id", documentId: "other-id" },
      { requestId: "mismatched-request-order-link", request: { orderId: "other-id" } },
    ];

    for (const [index, testCase] of cases.entries()) {
      const request = makeRequest();
      const requestId = testCase.requestId;
      await seedPendingRequest(requestId, request);
      const db = testEnv.authenticatedContext("admin-1").firestore();
      const order = makeOrder(request, {
        requestId,
        ...testCase.order,
      });
      const batch = writeBatch(db);
      batch.update(doc(db, `orderRequests/${requestId}`), {
        status: "approved",
        orderId: testCase.request?.orderId || requestId,
        reviewedAt: serverTimestamp(),
        reviewedBy: "admin-1",
      });
      batch.set(
        doc(db, `orders/${testCase.documentId || requestId}`),
        order,
      );
      await assertFails(batch.commit(), `mismatched linkage ${index + 1}`);
    }
  });

  it("denies direct approval and order creation for a pending request", async () => {
    const requestId = "duplicate-approval";
    const request = makeRequest();
    await seedPendingRequest(requestId, request);
    const db = testEnv.authenticatedContext("admin-1").firestore();
    await assertFails(
      updateDoc(
        doc(db, `orderRequests/${requestId}`),
        makeEmbeddedApproval(requestId, request),
      ),
    );

    await assertFails(
      setDoc(
        doc(db, `orders/${requestId}`),
        makeOrder(request, { requestId }),
      ),
    );
    const pendingRequest = await getDoc(doc(db, `orderRequests/${requestId}`));
    const officialOrder = await getDoc(doc(db, `orders/${requestId}`));
    assert.equal(pendingRequest.data().status, "pending");
    assert.equal(officialOrder.exists(), false);
  });

  it("does not allow rejected requests to become approved or create orders", async () => {
    const requestId = "rejected-request";
    await seedPendingRequest(requestId);
    const db = testEnv.authenticatedContext("admin-1").firestore();
    await assertSucceeds(
      updateDoc(doc(db, `orderRequests/${requestId}`), {
        status: "rejected",
        reviewedAt: serverTimestamp(),
        reviewedBy: "admin-1",
        rejectionReason: "Item unavailable",
      }),
    );
    await assertFails(
      updateDoc(doc(db, `orderRequests/${requestId}`), {
        status: "approved",
        orderId: requestId,
        reviewedAt: serverTimestamp(),
        reviewedBy: "admin-1",
      }),
    );
  });

  it("restricts request reads to the owner or an administrator", async () => {
    const requestId = "request-read-isolation";
    await seedPendingRequest(requestId);
    const ownerDb = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    const otherDb = testEnv
      .authenticatedContext("customer-2", { email: "other@example.test" })
      .firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertSucceeds(getDoc(doc(ownerDb, `orderRequests/${requestId}`)));
    await assertFails(getDoc(doc(otherDb, `orderRequests/${requestId}`)));
    await assertSucceeds(getDoc(doc(adminDb, `orderRequests/${requestId}`)));
  });
});

describe("reservation access", () => {
  it("allows customers to create only their own pending reservations", async () => {
    const db = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(
      setDoc(
        doc(db, "reservations/missing-reference-claim"),
        makeReservation("customer-1", {
          paymentReference: "MISSINGCLAIM001",
        }),
      ),
    );
    await assertSucceeds(
      createReservationWithReference(
        db,
        "reservation-1",
        makeReservation("customer-1"),
      ),
    );
    await assertSucceeds(
      createReservationWithReference(
        db,
        "full-payment-reservation",
        makeReservation("customer-1", {
          paymentReference: "TESTREF002",
          selectedPaymentOption: "full",
          amountPaidNow: 100,
          remainingBalance: 0,
        }),
      ),
    );
    await assertFails(
      createReservationWithReference(
        db,
        "reservation-2",
        makeReservation("customer-2", { paymentReference: "TESTREF003" }),
      ),
    );
    await assertFails(
      createReservationWithReference(
        db,
        "reservation-3",
        makeReservation("customer-1", {
          paymentReference: "TESTREF004",
          status: "Confirmed",
        }),
      ),
    );
    await assertFails(
      createReservationWithReference(
        db,
        "reservation-4",
        makeReservation("customer-1", {
          paymentReference: "TESTREF005",
          amountPaidNow: 99,
        }),
      ),
    );
    await assertFails(
      createReservationWithReference(
        db,
        "reservation-5",
        makeReservation("customer-1", {
          paymentReference: "TESTREF006",
          paymentStatus: "paid",
        }),
      ),
    );
    const reservationWithoutProof = makeReservation("customer-1");
    reservationWithoutProof.paymentReference = "TESTREF007";
    delete reservationWithoutProof.paymentProofUrl;
    await assertFails(
      createReservationWithReference(
        db,
        "reservation-without-proof",
        reservationWithoutProof,
      ),
    );
    await assertFails(
      createReservationWithReference(
        db,
        "reservation-invalid-proof",
        makeReservation("customer-1", {
          paymentReference: "TESTREF008",
          paymentProofUrl: "https://example.test/receipt.jpg",
        }),
      ),
    );
  });

  it("prevents customers from editing or deleting reservations", async () => {
    const db = testEnv.authenticatedContext("customer-1").firestore();
    await createReservationWithReference(
      db,
      "reservation-1",
      makeReservation("customer-1"),
    );

    await assertFails(
      updateDoc(doc(db, "reservations/reservation-1"), {
        status: "Confirmed",
      }),
    );
    await assertFails(deleteDoc(doc(db, "reservations/reservation-1")));
  });

  it("allows staff to update operational reservation status", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "reservations/staff-reservation"),
        makeReservation("customer-1"),
      );
    });

    const db = testEnv.authenticatedContext("staff-1").firestore();
    await assertSucceeds(
      updateDoc(doc(db, "reservations/staff-reservation"), {
        status: "Confirmed",
      }),
    );
  });
});

describe("phone registry and blocked phone access", () => {
  it("keeps registry mappings private while allowing UID-free duplicate checks", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, "users/customer-1"), {
          phone: "09123456789",
          phoneNumber: "09123456789",
        }, { merge: true }),
        setDoc(doc(db, "users/customer-2"), {
          phone: "09234567890",
          phoneNumber: "09234567890",
        }, { merge: true }),
        setDoc(doc(db, "phoneRegistry/09123456789"), {
          uid: "customer-1",
          phone: "09123456789",
          updatedAt: Timestamp.fromMillis(1000),
        }),
        setDoc(doc(db, "phoneRegistry/09234567890"), {
          uid: "customer-2",
          phone: "09234567890",
          updatedAt: Timestamp.fromMillis(1000),
        }),
        setDoc(doc(db, "phoneClaims/09123456789"), {
          phone: "09123456789",
        }),
        setDoc(doc(db, "phoneClaims/09234567890"), {
          phone: "09234567890",
        }),
        setDoc(doc(db, "blockedPhones/09123456789"), {
          phone: "09123456789",
          customerName: "Customer One",
          address: "Private address",
          reason: "Private reason",
        }),
        setDoc(doc(db, "blockedPhones/09234567890"), {
          phone: "09234567890",
          customerName: "Customer Two",
          address: "Other private address",
          reason: "Other private reason",
        }),
      ]);
    });

    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    await assertSucceeds(
      getDoc(doc(customerDb, "phoneRegistry/09123456789")),
    );
    await assertFails(
      getDoc(doc(customerDb, "phoneRegistry/09234567890")),
    );
    await assertSucceeds(
      getDoc(doc(customerDb, "phoneRegistry/09345678901")),
    );
    await assertSucceeds(
      getDoc(doc(customerDb, "phoneClaims/09234567890")),
    );
    await assertFails(getDocs(collection(customerDb, "phoneClaims")));
    await assertSucceeds(
      getDoc(doc(customerDb, "blockedPhones/09123456789")),
    );
    await assertFails(
      getDoc(doc(customerDb, "blockedPhones/09234567890")),
    );
    await assertSucceeds(
      getDoc(doc(customerDb, "blockedPhones/09345678901")),
    );
    assert.equal(
      await isPhoneBlocked(customerDb, "09234567890"),
      true,
      "A denied read of an existing foreign block should remain a positive block check.",
    );

    const staffDb = testEnv.authenticatedContext("staff-1").firestore();
    await assertSucceeds(
      getDoc(doc(staffDb, "phoneRegistry/09234567890")),
    );
    await assertSucceeds(
      getDoc(doc(staffDb, "blockedPhones/09234567890")),
    );
  });

  it("requires a customer phone claim to match the profile in the same commit", async () => {
    const db = testEnv.authenticatedContext("customer-1").firestore();
    const validBatch = writeBatch(db);
    validBatch.update(doc(db, "users/customer-1"), {
      phone: "09123456789",
      phoneNumber: "09123456789",
      phoneUpdatedAt: serverTimestamp(),
    });
    validBatch.set(doc(db, "phoneRegistry/09123456789"), {
      uid: "customer-1",
      phone: "09123456789",
      updatedAt: serverTimestamp(),
    });
    validBatch.set(doc(db, "phoneClaims/09123456789"), {
      phone: "09123456789",
    });
    await assertSucceeds(validBatch.commit());

    const unrelatedClaimBatch = writeBatch(db);
    unrelatedClaimBatch.set(doc(db, "phoneRegistry/09234567890"), {
      uid: "customer-1",
      phone: "09234567890",
      updatedAt: serverTimestamp(),
    });
    unrelatedClaimBatch.set(doc(db, "phoneClaims/09234567890"), {
      phone: "09234567890",
    });
    await assertFails(unrelatedClaimBatch.commit());
  });
});

describe("staff operational and restricted data access", () => {
  it("allows operational reads but keeps customer and security records private", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, "orderRequests/request-1"), makeRequest()),
        setDoc(
          doc(db, "reservations/reservation-1"),
          makeReservation("customer-1"),
        ),
        setDoc(doc(db, "paymentSelections/request-1"), {
          requestId: "request-1",
          customerId: "customer-1",
          method: "qr",
          timing: "advance",
          createdAt: Timestamp.fromMillis(1000),
          updatedAt: Timestamp.fromMillis(1000),
        }),
        setDoc(doc(db, "paymentRecords/order-1"), {
          customerId: "customer-1",
          orderId: "order-1",
        }),
        setDoc(
          doc(db, "paymentRecords/order-1/submissions/attempt-1"),
          { customerId: "customer-1", orderId: "order-1" },
        ),
        setDoc(doc(db, "blockedPhones/09123456789"), {
          phone: "09123456789",
        }),
        setDoc(doc(db, "menuControl/migration"), {
          state: "ready",
          startedAt: Timestamp.fromMillis(1000),
          updatedAt: Timestamp.fromMillis(1000),
          updatedBy: "admin-1",
        }),
      ]);
    });

    const db = testEnv.authenticatedContext("staff-1").firestore();
    await assertSucceeds(getDoc(doc(db, "orderRequests/request-1")));
    await assertSucceeds(getDoc(doc(db, "reservations/reservation-1")));
    await assertSucceeds(getDoc(doc(db, "paymentSelections/request-1")));
    await assertSucceeds(getDoc(doc(db, "paymentRecords/order-1")));
    await assertSucceeds(
      getDoc(doc(db, "paymentRecords/order-1/submissions/attempt-1")),
    );
    await assertSucceeds(getDocs(collection(db, "blockedPhones")));
    await assertSucceeds(getDoc(doc(db, "menuControl/migration")));
    await assertFails(getDoc(doc(db, "users/customer-1")));
    await assertFails(getDocs(collection(db, "users")));
    await assertFails(getDocs(collection(db, "phoneRestorationRequests")));
    await assertFails(getDoc(doc(db, "monthlyRecords/current")));
  });

  it("allows staff to manage blocked phone entries without granting user access", async () => {
    const db = testEnv.authenticatedContext("staff-1").firestore();
    const blockedPhone = doc(db, "blockedPhones/09123456789");

    await assertSucceeds(
      setDoc(blockedPhone, {
        phone: "09123456789",
        reason: "Repeated no-shows",
        blockedBy: "staff-1",
        blockedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(deleteDoc(blockedPhone));
    await assertFails(getDoc(doc(db, "users/customer-1")));
  });
});

describe("review access", () => {
  const makePublicReview = (overrides = {}) => ({
    rating: 5,
    comment: "Great coffee",
    createdAt: Timestamp.now(),
    displayName: "Cactus Café Customer",
    ...overrides,
  });

  it("accepts valid reviews from their author and rejects invalid submissions", async () => {
    const db = testEnv.authenticatedContext("customer-1").firestore();

    await assertSucceeds(
      setDoc(doc(db, "reviews/review-1"), {
        customerId: "customer-1",
        status: "Pending",
        rating: 5,
        comment: "Great coffee",
      }),
    );
    await assertFails(
      setDoc(doc(db, "reviews/review-2"), {
        customerId: "customer-2",
        status: "Pending",
        rating: 5,
        comment: "Great coffee",
      }),
    );
  });

  it("allows admins to moderate reviews but not edit customer content", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, "reviews/review-1"), {
          customerId: "customer-1",
          status: "Pending",
          rating: 5,
          comment: "Great coffee",
        }),
        setDoc(doc(db, "publicReviews/review-1"), makePublicReview()),
      ]);
    });
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(
      updateDoc(doc(customerDb, "reviews/review-1"), {
        status: "Hidden",
        moderatedAt: serverTimestamp(),
        moderatedBy: "customer-1",
      }),
    );
    await assertSucceeds(
      updateDoc(doc(adminDb, "reviews/review-1"), {
        status: "Hidden",
        moderatedAt: serverTimestamp(),
        moderatedBy: "admin-1",
      }),
    );
    await assertFails(
      updateDoc(doc(adminDb, "reviews/review-1"), { comment: "Changed" }),
    );
    await assertFails(deleteDoc(doc(adminDb, "reviews/review-1")));

    const deleteBatch = writeBatch(adminDb);
    deleteBatch.delete(doc(adminDb, "reviews/review-1"));
    deleteBatch.delete(doc(adminDb, "publicReviews/review-1"));
    await assertSucceeds(deleteBatch.commit());
  });

  it("allows anonymous reads of valid public reviews", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "publicReviews/valid-review"),
        makePublicReview(),
      );
    });

    const db = testEnv.unauthenticatedContext().firestore();

    await assertSucceeds(
      getDoc(doc(db, "publicReviews/valid-review")),
    );
  });

  it("allows anonymous collection reads containing only public review fields", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(
          doc(db, "publicReviews/public-review-1"),
          makePublicReview(),
        ),
        setDoc(
          doc(db, "publicReviews/public-review-2"),
          makePublicReview({ rating: 4, comment: "Lovely atmosphere" }),
        ),
      ]);
    });

    const db = testEnv.unauthenticatedContext().firestore();
    const snapshot = await assertSucceeds(
      getDocs(collection(db, "publicReviews")),
    );
    const allowedFields = [
      "comment",
      "createdAt",
      "displayName",
      "rating",
    ];

    assert.equal(snapshot.size, 2);
    for (const publicReview of snapshot.docs) {
      assert.deepEqual(
        Object.keys(publicReview.data()).sort(),
        allowedFields,
      );
    }
  });

  it("requires customer public reviews to be paired with a private review", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "publicReviews/existing-review"),
        makePublicReview(),
      );
    });

    const db = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(
      setDoc(
        doc(db, "publicReviews/customer-created-review"),
        makePublicReview(),
      ),
    );
    const batch = writeBatch(db);
    batch.set(doc(db, "reviews/customer-review"), {
      customerId: "customer-1",
      customerEmail: "customer@example.test",
      customerName: "Jeanrose Suplada",
      photoURL: "",
      rating: 5,
      comment: "Great coffee",
      status: "Approved",
      createdAt: Timestamp.now(),
    });
    batch.set(
      doc(db, "publicReviews/customer-review"),
      makePublicReview({ displayName: "Jean****", photoURL: "" }),
    );
    await assertSucceeds(batch.commit());

    const mismatchedRatingBatch = writeBatch(db);
    mismatchedRatingBatch.set(doc(db, "reviews/mismatched-rating"), {
      customerId: "customer-1",
      rating: 4,
      comment: "Great coffee",
    });
    mismatchedRatingBatch.set(
      doc(db, "publicReviews/mismatched-rating"),
      makePublicReview({ rating: 5 }),
    );
    await assertFails(mismatchedRatingBatch.commit());

    const mismatchedCommentBatch = writeBatch(db);
    mismatchedCommentBatch.set(doc(db, "reviews/mismatched-comment"), {
      customerId: "customer-1",
      rating: 5,
      comment: "Great coffee",
    });
    mismatchedCommentBatch.set(
      doc(db, "publicReviews/mismatched-comment"),
      makePublicReview({ comment: "Different public comment" }),
    );
    await assertFails(mismatchedCommentBatch.commit());

    await assertFails(
      updateDoc(doc(db, "publicReviews/existing-review"), {
        comment: "Changed comment",
      }),
    );
    await assertFails(
      deleteDoc(doc(db, "publicReviews/existing-review")),
    );
  });

  it("allows admins to create, update, and delete public reviews", async () => {
    const db = testEnv.authenticatedContext("admin-1").firestore();
    const reviewRef = doc(db, "publicReviews/admin-review");

    await assertSucceeds(setDoc(reviewRef, makePublicReview()));
    await assertSucceeds(updateDoc(reviewRef, makePublicReview({ rating: 4 })));
    await assertSucceeds(deleteDoc(reviewRef));
  });

  it("rejects public review documents with invalid fields or shapes", async () => {
    const db = testEnv.authenticatedContext("admin-1").firestore();
    const invalidReviews = [
      makePublicReview({ customerId: "customer-1" }),
      makePublicReview({ customerEmail: "customer@example.test" }),
      makePublicReview({ displayName: "" }),
      makePublicReview({ displayName: "x".repeat(41) }),
      makePublicReview({ rating: 6 }),
      makePublicReview({ rating: 4.5 }),
      makePublicReview({ comment: "" }),
      makePublicReview({ createdAt: "not-a-timestamp" }),
      makePublicReview({ photoURL: 12 }),
      makePublicReview({ photoURL: "x".repeat(501) }),
      {
        rating: 5,
        comment: "Missing display name",
        createdAt: Timestamp.now(),
      },
    ];

    for (const [index, review] of invalidReviews.entries()) {
      await assertFails(
        setDoc(doc(db, `publicReviews/invalid-review-${index}`), review),
      );
    }

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "publicReviews/update-review"),
        makePublicReview(),
      );
    });

    await assertFails(
      updateDoc(doc(db, "publicReviews/update-review"), {
        customerEmail: "customer@example.test",
      }),
    );
  });
});

describe("main Rules: embedded approved-order schema", () => {
    it("denies direct approval and order creation for a valid one-item request", async () => {
      const requestId = "embedded-approved-one-item";
      const request = makeRequest();
      await seedPendingRequest(requestId, request);
      const adminDb = testEnv.authenticatedContext("admin-1").firestore();

      await assertFails(
        updateDoc(
          doc(adminDb, `orderRequests/${requestId}`),
          makeEmbeddedApproval(requestId, request),
        ),
      );
      await assertFails(
        setDoc(
          doc(adminDb, `orders/${requestId}`),
          makeOrder(request, { requestId }),
        ),
      );

      const pendingRequest = (
        await getDoc(doc(adminDb, `orderRequests/${requestId}`))
      ).data();
      assert.equal(pendingRequest.status, "pending");
      assert.equal(
        (await getDoc(doc(adminDb, `orders/${requestId}`))).exists(),
        false,
      );
    });

    it("denies direct approval and order creation for a valid ten-item request", async () => {
      const requestId = "embedded-approved-ten-items";
      const request = makeRequest({
        items: Array.from({ length: 10 }, (_, index) => ({
          id: `menu-${index + 1}`,
          quantity: index + 1,
        })),
      });
      await seedPendingRequest(requestId, request);
      const adminDb = testEnv.authenticatedContext("admin-1").firestore();

      await assertFails(
        updateDoc(
          doc(adminDb, `orderRequests/${requestId}`),
          makeEmbeddedApproval(requestId, request),
        ),
      );
      await assertFails(
        setDoc(
          doc(adminDb, `orders/${requestId}`),
          makeOrder(request, { requestId }),
        ),
      );

      const pendingRequest = (
        await getDoc(doc(adminDb, `orderRequests/${requestId}`))
      ).data();
      assert.equal(pendingRequest.status, "pending");
      assert.equal(
        (await getDoc(doc(adminDb, `orders/${requestId}`))).exists(),
        false,
      );
    });

    it("does not allow a customer to approve their own request", async () => {
      const requestId = "embedded-customer-approval-denied";
      const request = makeRequest();
      await seedPendingRequest(requestId, request);
      const customerDb = testEnv.authenticatedContext("customer-1").firestore();

      await assertFails(
        updateDoc(
          doc(customerDb, `orderRequests/${requestId}`),
          makeEmbeddedApproval(requestId, request),
        ),
      );
    });

    it("does not allow a non-admin to approve a request", async () => {
      const requestId = "embedded-non-admin-approval-denied";
      const request = makeRequest();
      await seedPendingRequest(requestId, request);
      const customerDb = testEnv.authenticatedContext("customer-2").firestore();

      await assertFails(
        updateDoc(
          doc(customerDb, `orderRequests/${requestId}`),
          makeEmbeddedApproval(requestId, request),
        ),
      );
    });

    it("rejects invalid requested or approved item IDs and quantities", async () => {
      const validRequest = makeRequest();
      const validApproval = makeEmbeddedApproval(
        "unused",
        validRequest,
      );
      const cases = [
        {
          request: makeRequest({ items: [{ id: "invalid/item", quantity: 2 }] }),
        },
        {
          request: makeRequest({ items: [{ id: "coffee", quantity: 100 }] }),
        },
        {
          request: validRequest,
          approval: makeEmbeddedApproval("unused", validRequest, {
            approvedOrder: {
              ...validApproval.approvedOrder,
              items: [{ ...validApproval.approvedOrder.items[0], id: "tea" }],
            },
          }),
        },
        {
          request: validRequest,
          approval: makeEmbeddedApproval("unused", validRequest, {
            approvedOrder: {
              ...validApproval.approvedOrder,
              items: [{
                ...validApproval.approvedOrder.items[0],
                quantity: 3,
                subtotal: 12,
              }],
            },
          }),
        },
      ];

      for (const [index, testCase] of cases.entries()) {
        const requestId = `embedded-invalid-item-${index}`;
        await seedPendingRequest(requestId, testCase.request);
        const adminDb = testEnv.authenticatedContext("admin-1").firestore();
        const approval = testCase.approval
          ? {
              ...testCase.approval,
              orderId: requestId,
            }
          : makeEmbeddedApproval(requestId, testCase.request);

        await assertFails(
          updateDoc(doc(adminDb, `orderRequests/${requestId}`), approval),
        );
      }
    });

    it("rejects invalid prices, subtotals, and totals", async () => {
      const request = makeRequest();
      const validApproval = makeEmbeddedApproval("unused", request);
      const validItem = validApproval.approvedOrder.items[0];
      const cases = [
        {
          approvedOrder: {
            ...validApproval.approvedOrder,
            items: [{ ...validItem, price: 1000001, subtotal: 2000002 }],
            total: 2000002,
          },
        },
        {
          approvedOrder: {
            ...validApproval.approvedOrder,
            items: [{ ...validItem, subtotal: 9 }],
            total: 9,
          },
        },
        {
          approvedOrder: {
            ...validApproval.approvedOrder,
            total: 9,
          },
        },
      ];

      for (const [index, override] of cases.entries()) {
        const requestId = `embedded-invalid-price-total-${index}`;
        await seedPendingRequest(requestId, request);
        const adminDb = testEnv.authenticatedContext("admin-1").firestore();

        await assertFails(
          updateDoc(
            doc(adminDb, `orderRequests/${requestId}`),
            makeEmbeddedApproval(requestId, request, override),
          ),
        );
      }
    });

    it("rejects invalid approval metadata and unexpected fields", async () => {
      const request = makeRequest();
      const cases = [
        { reviewedBy: "customer-1" },
        { orderId: "different-request" },
        { reviewedAt: Timestamp.fromMillis(0) },
        { unexpectedField: true },
        {
          approvedOrder: {
            ...makeEmbeddedApproval("unused", request).approvedOrder,
            unexpectedField: true,
          },
        },
      ];

      for (const [index, override] of cases.entries()) {
        const requestId = `embedded-invalid-metadata-${index}`;
        await seedPendingRequest(requestId, request);
        const adminDb = testEnv.authenticatedContext("admin-1").firestore();

        await assertFails(
          updateDoc(
            doc(adminDb, `orderRequests/${requestId}`),
            makeEmbeddedApproval(requestId, request, override),
          ),
        );
      }
    });

    it("allows an admin to reject a pending request with a valid reason", async () => {
      const requestId = "embedded-valid-rejection";
      await seedPendingRequest(requestId);
      const adminDb = testEnv.authenticatedContext("admin-1").firestore();

      await assertSucceeds(
        updateDoc(doc(adminDb, `orderRequests/${requestId}`), {
          status: "rejected",
          reviewedAt: serverTimestamp(),
          reviewedBy: "admin-1",
          rejectionReason: "Item unavailable",
        }),
      );

      const rejectedRequest = (
        await getDoc(doc(adminDb, `orderRequests/${requestId}`))
      ).data();
      assert.equal(rejectedRequest.status, "rejected");
      assert.equal(rejectedRequest.approvedOrder, undefined);
      assert.equal(rejectedRequest.orderStatus, undefined);
    });

    it("rejects a rejection update containing approved-order data", async () => {
      const requestId = "embedded-rejection-with-order-data";
      await seedPendingRequest(requestId);
      const adminDb = testEnv.authenticatedContext("admin-1").firestore();
      const approval = makeEmbeddedApproval(requestId);

      await assertFails(
        updateDoc(doc(adminDb, `orderRequests/${requestId}`), {
          status: "rejected",
          reviewedAt: serverTimestamp(),
          reviewedBy: "admin-1",
          rejectionReason: "Item unavailable",
          approvedOrder: approval.approvedOrder,
          orderStatus: "Pending",
        }),
      );
    });

    it("does not allow a customer to modify an approved request", async () => {
      const requestId = "embedded-customer-modification-denied";
      await seedApprovedRequest(requestId);
      const customerDb = testEnv.authenticatedContext("customer-1").firestore();

      await assertFails(
        updateDoc(doc(customerDb, `orderRequests/${requestId}`), {
          orderStatus: "Preparing",
        }),
      );
      await assertFails(
        updateDoc(doc(customerDb, `orderRequests/${requestId}`), {
          "approvedOrder.total": 0,
        }),
      );
    });

    it("allows an admin to update only the permitted orderStatus field", async () => {
      const requestId = "embedded-admin-status-update";
      await seedApprovedRequest(requestId);
      const adminDb = testEnv.authenticatedContext("admin-1").firestore();

      await assertSucceeds(
        updateDoc(doc(adminDb, `orderRequests/${requestId}`), {
          orderStatus: "Preparing",
        }),
      );

      const approvedRequest = (
        await getDoc(doc(adminDb, `orderRequests/${requestId}`))
      ).data();
      assert.equal(approvedRequest.orderStatus, "Preparing");
    });

    it("does not allow an admin to modify approved order or approval details", async () => {
      const request = makeRequest();
      const changes = [
        { customerName: "Changed customer" },
        {
          "approvedOrder.items": [{
            id: "coffee",
            name: "Changed coffee",
            price: 4,
            quantity: 2,
            subtotal: 8,
          }],
        },
        {
          "approvedOrder.items": [{
            id: "coffee",
            name: "Coffee",
            price: 99,
            quantity: 2,
            subtotal: 198,
          }],
        },
        { "approvedOrder.total": 999 },
        { reviewedBy: "customer-1" },
        { orderId: "different-request" },
      ];

      for (const [index, change] of changes.entries()) {
        const requestId = `embedded-protected-update-${index}`;
        await seedApprovedRequest(requestId, request);
        const adminDb = testEnv.authenticatedContext("admin-1").firestore();

        await assertFails(
          updateDoc(doc(adminDb, `orderRequests/${requestId}`), {
            orderStatus: "Preparing",
            ...change,
          }),
        );
      }
    });

    it("rejects invalid embedded order fulfillment statuses", async () => {
      const requestId = "embedded-invalid-fulfillment-status";
      await seedApprovedRequest(requestId);
      const adminDb = testEnv.authenticatedContext("admin-1").firestore();

      await assertFails(
        updateDoc(doc(adminDb, `orderRequests/${requestId}`), {
          orderStatus: "Refunded",
        }),
      );
    });

    it("does not approve an embedded order when a historical order has the same ID", async () => {
      const requestId = "order-1";
      const request = makeRequest();
      await seedPendingRequest(requestId, request);
      const adminDb = testEnv.authenticatedContext("admin-1").firestore();

      await assertFails(
        updateDoc(
          doc(adminDb, `orderRequests/${requestId}`),
          makeEmbeddedApproval(requestId, request),
        ),
      );
    });

    it("preserves historical order reads and admin-only status updates", async () => {
      const ownerDb = testEnv.authenticatedContext("customer-1").firestore();
      const otherCustomerDb = testEnv
        .authenticatedContext("customer-2")
        .firestore();
      const adminDb = testEnv.authenticatedContext("admin-1").firestore();

      await assertSucceeds(getDoc(doc(ownerDb, "orders/order-1")));
      await assertFails(getDoc(doc(otherCustomerDb, "orders/order-1")));
      await assertSucceeds(getDoc(doc(adminDb, "orders/order-1")));
      await assertFails(
        updateDoc(doc(ownerDb, "orders/order-1"), { status: "Confirmed" }),
      );
      await assertSucceeds(
        updateDoc(doc(adminDb, "orders/order-1"), { status: "Confirmed" }),
      );
      await assertFails(
        updateDoc(doc(adminDb, "orders/order-1"), { total: 99 }),
      );
    });
});

describe("prototype Rules: direct order access", () => {
  before(async () => {
    directCheckoutTestEnv = await initializeTestEnvironment({
      projectId: directCheckoutProjectId,
      firestore: { rules: prototypeRules },
    });
  });

  beforeEach(async () => {
    await directCheckoutTestEnv.clearFirestore();
    await directCheckoutTestEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, "users/admin-1"), { role: "admin" }),
        setDoc(doc(db, "users/customer-1"), { role: "customer" }),
        setDoc(doc(db, "users/customer-2"), { role: "customer" }),
        setDoc(doc(db, "orders/order-1"), {
          customerId: "customer-1",
          status: "Pending",
          total: 8,
        }),
      ]);
    });
  });

  after(async () => {
    await directCheckoutTestEnv.cleanup();
  });

  describe("prototype approval transaction", () => {
    async function seedPendingPrototypeRequest(
      requestId,
      request = makeRequest(),
    ) {
      await directCheckoutTestEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(
          doc(context.firestore(), `orderRequests/${requestId}`),
          request,
        );
      });
    }

    it("[prototype approval] allows an admin to approve a pending request and create its matching order atomically", async () => {
      const requestId = "prototype-valid-approval";
      const request = makeRequest();
      await seedPendingPrototypeRequest(requestId, request);
      const adminDb = directCheckoutTestEnv
        .authenticatedContext("admin-1")
        .firestore();

      await assertSucceeds(
        approveOrder(
          adminDb,
          requestId,
          request,
          makePrototypeOrder(request, { requestId }),
        ),
      );

      const approvedRequest = await getDoc(
        doc(adminDb, `orderRequests/${requestId}`),
      );
      const officialOrder = await getDoc(doc(adminDb, `orders/${requestId}`));
      assert.equal(approvedRequest.data().status, "approved");
      assert.equal(approvedRequest.data().orderId, requestId);
      assert.equal(approvedRequest.data().reviewedBy, "admin-1");
      assert.equal(officialOrder.exists(), true);
      assert.equal(officialOrder.data().customerId, request.customerId);
      assert.equal(officialOrder.data().total, 8);
    });

    it("[prototype approval] atomically approves an order with ten validated items", async () => {
      const requestId = "prototype-valid-10-item-approval";
      const request = makeRequest({
        items: Array.from({ length: 10 }, (_, index) => ({
          id: `menu-${index + 1}`,
          quantity: index + 1,
        })),
      });
      await seedPendingPrototypeRequest(requestId, request);
      const adminDb = directCheckoutTestEnv
        .authenticatedContext("admin-1")
        .firestore();

      await assertSucceeds(
        approveOrder(
          adminDb,
          requestId,
          request,
          makePrototypeOrder(request, { requestId }),
        ),
      );

      const approvedRequest = await getDoc(
        doc(adminDb, `orderRequests/${requestId}`),
      );
      const officialOrder = await getDoc(doc(adminDb, `orders/${requestId}`));
      const expectedItems = request.items.map(({ id, quantity }) => ({
        id,
        name: "Menu item",
        price: 4,
        quantity,
        subtotal: 4 * quantity,
      }));

      assert.equal(approvedRequest.data().status, "approved");
      assert.equal(approvedRequest.data().orderId, requestId);
      assert.deepEqual(officialOrder.data().items, expectedItems);
      assert.equal(officialOrder.data().total, 220);
    });

    it("[prototype approval] denies an approval when the administrator profile is missing", async () => {
      const requestId = "prototype-missing-admin-profile";
      const request = makeRequest();
      await seedPendingPrototypeRequest(requestId, request);
      const db = directCheckoutTestEnv
        .authenticatedContext("admin-without-profile")
        .firestore();

      await assertDeniedWithoutRuleEvaluationError(
        approveOrder(
          db,
          requestId,
          request,
          makePrototypeOrder(request, { requestId }),
        ),
      );
    });

    it("[prototype approval] denies a duplicate approval", async () => {
      const requestId = "prototype-duplicate-approval";
      const request = makeRequest();
      await seedPendingPrototypeRequest(requestId, request);
      const adminDb = directCheckoutTestEnv
        .authenticatedContext("admin-1")
        .firestore();

      const prototypeOrder = makePrototypeOrder(request, { requestId });
      await assertSucceeds(
        approveOrder(adminDb, requestId, request, prototypeOrder),
      );
      await assertDeniedWithoutRuleEvaluationError(
        approveOrder(adminDb, requestId, request, prototypeOrder),
      );
    });

    it("[prototype approval] denies mismatched request and order customer data", async () => {
      const requestId = "prototype-mismatched-approval";
      const request = makeRequest();
      await seedPendingPrototypeRequest(requestId, request);
      const adminDb = directCheckoutTestEnv
        .authenticatedContext("admin-1")
        .firestore();

      await assertDeniedWithoutRuleEvaluationError(
        approveOrder(
          adminDb,
          requestId,
          request,
          makePrototypeOrder(request, {
            requestId,
            customerName: "Different Customer",
          }),
        ),
      );
    });

    it("[prototype approval] denies mismatched request and order IDs", async () => {
      const requestId = "prototype-mismatched-order-id";
      const orderId = `${requestId}-other`;
      const request = makeRequest();
      await seedPendingPrototypeRequest(requestId, request);
      const adminDb = directCheckoutTestEnv
        .authenticatedContext("admin-1")
        .firestore();
      const batch = writeBatch(adminDb);
      batch.update(doc(adminDb, `orderRequests/${requestId}`), {
        status: "approved",
        orderId,
        reviewedAt: serverTimestamp(),
        reviewedBy: "admin-1",
      });
      batch.set(
        doc(adminDb, `orders/${orderId}`),
        makePrototypeOrder(request, { requestId: orderId }),
      );

      await assertDeniedWithoutRuleEvaluationError(batch.commit());
    });

    it("[prototype approval] rejects requests with no items", async () => {
      const customerDb = directCheckoutTestEnv
        .authenticatedContext("customer-1")
        .firestore();

      await assertDeniedWithoutRuleEvaluationError(
        setDoc(
          doc(customerDb, "orderRequests/prototype-empty-items"),
          makeRequest({ items: [] }),
        ),
      );
    });

    it("[prototype approval] rejects requests with more than ten items", async () => {
      const customerDb = directCheckoutTestEnv
        .authenticatedContext("customer-1")
        .firestore();
      const request = makeRequest({
        items: Array.from({ length: 11 }, (_, index) => ({
          id: `menu-${index + 1}`,
          quantity: 1,
        })),
      });

      await assertDeniedWithoutRuleEvaluationError(
        setDoc(
          doc(customerDb, "orderRequests/eleven-items"),
          request,
        ),
      );
    });

    it("[prototype approval] denies creating an order without updating its pending request", async () => {
      const requestId = "prototype-order-without-approval";
      const request = makeRequest();
      await seedPendingPrototypeRequest(requestId, request);
      const adminDb = directCheckoutTestEnv
        .authenticatedContext("admin-1")
        .firestore();

      await assertDeniedWithoutRuleEvaluationError(
        setDoc(
          doc(adminDb, `orders/${requestId}`),
          makePrototypeOrder(request, { requestId }),
        ),
      );
    });

    it("[prototype approval] denies approving a request without creating its matching order", async () => {
      const requestId = "prototype-approval-without-order";
      await seedPendingPrototypeRequest(requestId);
      const adminDb = directCheckoutTestEnv
        .authenticatedContext("admin-1")
        .firestore();

      await assertDeniedWithoutRuleEvaluationError(
        updateDoc(doc(adminDb, `orderRequests/${requestId}`), {
          status: "approved",
          orderId: requestId,
          reviewedAt: serverTimestamp(),
          reviewedBy: "admin-1",
        }),
      );
    });

    it("[prototype approval] denies a customer attempting the approval transaction", async () => {
      const requestId = "prototype-customer-approval-denied";
      const request = makeRequest();
      await seedPendingPrototypeRequest(requestId, request);
      const customerDb = directCheckoutTestEnv
        .authenticatedContext("customer-1")
        .firestore();

      await assertDeniedWithoutRuleEvaluationError(
        approveOrder(
          customerDb,
          requestId,
          request,
          makePrototypeOrder(request, { requestId }),
        ),
      );
    });

    it("[prototype approval] denies changing a different customer's details while approving", async () => {
      const requestId = "prototype-changed-customer-approval";
      const request = makeRequest();
      await seedPendingPrototypeRequest(requestId, request);
      const adminDb = directCheckoutTestEnv
        .authenticatedContext("admin-1")
        .firestore();
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
        makePrototypeOrder(changedRequest, { requestId }),
      );

      await assertDeniedWithoutRuleEvaluationError(batch.commit());
    });
  });

  it("denies client creation of a direct-checkout order", async () => {
    const db = directCheckoutTestEnv
      .authenticatedContext("customer-1")
      .firestore();

    await assertFails(
      setDoc(doc(db, "orders/client-created"), {
        customerId: "customer-1",
        customerEmail: "customer@example.test",
        customerName: "Cafe Customer",
        phone: "09123456789",
        orderType: "takeout",
        address: "",
        notes: "",
        items: [
          {
            id: "coffee",
            name: "Coffee",
            price: 4,
            quantity: 2,
            subtotal: 8,
          },
        ],
        total: 8,
        status: "Pending",
        createdAt: Timestamp.now(),
      }),
    );
  });

  it("allows customers to read their own order but not another customer's", async () => {
    const ownerDb = directCheckoutTestEnv
      .authenticatedContext("customer-1")
      .firestore();
    const otherDb = directCheckoutTestEnv
      .authenticatedContext("customer-2")
      .firestore();

    await assertSucceeds(getDoc(doc(ownerDb, "orders/order-1")));
    await assertFails(getDoc(doc(otherDb, "orders/order-1")));
  });

  it("allows admins to change only order status to a permitted value", async () => {
    const adminDb = directCheckoutTestEnv
      .authenticatedContext("admin-1")
      .firestore();

    await assertSucceeds(
      updateDoc(doc(adminDb, "orders/order-1"), { status: "Confirmed" }),
    );
    await assertFails(
      updateDoc(doc(adminDb, "orders/order-1"), { total: 99 }),
    );
    await assertFails(
      updateDoc(doc(adminDb, "orders/order-1"), { status: "Refunded" }),
    );
  });
});
