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

const projectId = "demo-cafe-spark-regression";
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

function makeOrder(request = makeRequest(), requestId = "request-1", overrides = {}) {
  const items = request.items.map(({ id, quantity }) => ({
    id,
    name: id === "coffee" ? "Coffee" : `Menu item ${id}`,
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

function makeApprovalBatch(db, requestId, request, orderOverrides = {}) {
  const batch = writeBatch(db);
  batch.update(doc(db, `orderRequests/${requestId}`), {
    status: "approved",
    orderId: requestId,
    reviewedAt: serverTimestamp(),
    reviewedBy: "admin-1",
  });
  batch.set(
    doc(db, `orders/${requestId}`),
    makeOrder(request, requestId, orderOverrides),
  );
  return batch;
}

function makeReservation(userId, overrides = {}) {
  return {
    userId,
    customerEmail: `${userId}@example.test`,
    customerName: userId === "customer-1" ? "Cafe Customer" : "Other Customer",
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
    paymentReference: "TEST-REF-001",
    paymentStatus: "pending_review",
    ...overrides,
  };
}

function makePrivateReview(customerId, overrides = {}) {
  return {
    customerId,
    customerEmail: `${customerId}@example.test`,
    rating: 5,
    comment: "Great coffee",
    status: "Pending",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

function makePublicReview(overrides = {}) {
  return {
    rating: 5,
    comment: "Great coffee",
    createdAt: Timestamp.fromDate(new Date("2025-01-01T00:00:00Z")),
    displayName: "Cactus Café Customer",
    ...overrides,
  };
}

async function seed(path, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data);
  });
}

async function readSeeded(path) {
  let snapshot;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    snapshot = await getDoc(doc(context.firestore(), path));
  });
  return snapshot;
}

async function seedPendingRequest(requestId = "request-1", request = makeRequest()) {
  await seed(`orderRequests/${requestId}`, request);
}

async function seedOrder(requestId, request = makeRequest(), overrides = {}) {
  await seed(
    `orders/${requestId}`,
    makeOrder(request, requestId, overrides),
  );
}

async function seedUsers() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "users/admin-1"), {
        role: "admin",
        email: "admin@example.test",
      }),
      setDoc(doc(db, "users/customer-1"), {
        role: "customer",
        email: "customer@example.test",
      }),
      setDoc(doc(db, "users/customer-2"), {
        role: "customer",
        email: "other@example.test",
      }),
    ]);
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
  await seedUsers();
  await seedPendingRequest();
});

describe("menu item permissions", () => {
  it("allows public reads and Admin create, update, and delete", async () => {
    await seed("menuItems/coffee", { name: "Coffee", price: 4, available: true });

    const publicDb = testEnv.unauthenticatedContext().firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const menuRef = doc(adminDb, "menuItems/new-item");

    await assertSucceeds(getDoc(doc(publicDb, "menuItems/coffee")));
    const publicMenu = await assertSucceeds(
      getDocs(collection(publicDb, "menuItems")),
    );
    assert.equal(publicMenu.size, 1);
    await assertSucceeds(
      setDoc(menuRef, { name: "Tea", price: 3, available: true }),
    );
    await assertSucceeds(updateDoc(menuRef, { price: 3.5 }));
    await assertSucceeds(deleteDoc(menuRef));

    assert.equal((await readSeeded("menuItems/new-item")).exists(), false);
  });

  it("denies customer menu writes without changing menu data", async () => {
    await seed("menuItems/coffee", { name: "Coffee", price: 4, available: true });
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(
      setDoc(doc(customerDb, "menuItems/customer-item"), {
        name: "Tea",
        price: 3,
        available: true,
      }),
    );
    await assertFails(
      updateDoc(doc(customerDb, "menuItems/coffee"), { price: 0 }),
    );
    await assertFails(deleteDoc(doc(customerDb, "menuItems/coffee")));

    assert.equal((await readSeeded("menuItems/customer-item")).exists(), false);
    assert.equal((await readSeeded("menuItems/coffee")).data().price, 4);
  });
});

describe("user profile permissions", () => {
  it("allows customer self-read and denies another customer's profile read", async () => {
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();

    await assertSucceeds(getDoc(doc(customerDb, "users/customer-1")));
    await assertFails(getDoc(doc(customerDb, "users/customer-2")));
  });

  it("prevents customer self-promotion and confirms the stored role remains customer", async () => {
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(
      updateDoc(doc(customerDb, "users/customer-1"), { role: "admin" }),
    );

    assert.equal(
      (await readSeeded("users/customer-1")).data().role,
      "customer",
    );
  });

  it("allows Admin profile listing, updates, and deletion", async () => {
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    const users = await assertSucceeds(getDocs(collection(adminDb, "users")));
    assert.equal(users.size, 3);
    await assertSucceeds(
      updateDoc(doc(adminDb, "users/customer-2"), { displayName: "Updated" }),
    );
    await assertSucceeds(deleteDoc(doc(adminDb, "users/customer-2")));

    assert.equal(
      (await readSeeded("users/customer-2")).exists(),
      false,
    );
  });
});

describe("order permissions", () => {
  it("allows customers to read only their own orders", async () => {
    await seed("orders/customer-order", {
      ...makeOrder(),
      customerId: "customer-1",
    });
    await seed("orders/other-order", {
      ...makeOrder(makeRequest({ customerId: "customer-2" }), "other-order"),
      customerId: "customer-2",
    });

    const ownerDb = testEnv.authenticatedContext("customer-1").firestore();
    const otherDb = testEnv.authenticatedContext("customer-2").firestore();
    const ownerOrders = await assertSucceeds(
      getDocs(
        query(collection(ownerDb, "orders"), where("customerId", "==", "customer-1")),
      ),
    );

    assert.equal(ownerOrders.size, 1);
    await assertFails(getDoc(doc(ownerDb, "orders/other-order")));
    await assertFails(getDoc(doc(otherDb, "orders/customer-order")));
  });

  it("denies direct customer order creation and leaves no order behind", async () => {
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();

    await assertFails(
      setDoc(
        doc(customerDb, "orders/direct-order"),
        makeOrder(makeRequest(), "direct-order"),
      ),
    );

    assert.equal((await readSeeded("orders/direct-order")).exists(), false);
    assert.equal(
      (await readSeeded("orderRequests/request-1")).data().status,
      "pending",
    );
  });

  it("allows Admin status updates but rejects unsupported statuses and other field changes", async () => {
    await seed("orders/status-order", {
      ...makeOrder(),
      requestId: "status-order",
    });
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const orderRef = doc(adminDb, "orders/status-order");

    await assertSucceeds(updateDoc(orderRef, { status: "Confirmed" }));
    await assertFails(updateDoc(orderRef, { status: "Refunded" }));
    await assertFails(updateDoc(orderRef, { total: 99 }));

    const storedOrder = (await readSeeded("orders/status-order")).data();
    assert.equal(storedOrder.status, "Confirmed");
    assert.equal(storedOrder.total, 8);
  });
});

describe("order request permissions", () => {
  it("allows a customer to create a valid pending request for themselves", async () => {
    const customerDb = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    const request = makeRequest({ createdAt: serverTimestamp() });

    await assertSucceeds(
      setDoc(doc(customerDb, "orderRequests/customer-request"), request),
    );

    const storedRequest = (await readSeeded("orderRequests/customer-request")).data();
    assert.equal(storedRequest.customerId, "customer-1");
    assert.equal(storedRequest.status, "pending");
  });

  it("denies a customer request for another user and persists no request", async () => {
    const customerDb = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();

    await assertFails(
      setDoc(
        doc(customerDb, "orderRequests/forged-owner"),
        makeRequest({
          customerId: "customer-2",
          createdAt: serverTimestamp(),
        }),
      ),
    );

    assert.equal((await readSeeded("orderRequests/forged-owner")).exists(), false);
  });

  it("allows request reads for the owner and Admin, and denies another customer", async () => {
    const ownerDb = testEnv.authenticatedContext("customer-1").firestore();
    const otherDb = testEnv.authenticatedContext("customer-2").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const ownerRequests = await assertSucceeds(
      getDocs(
        query(
          collection(ownerDb, "orderRequests"),
          where("customerId", "==", "customer-1"),
        ),
      ),
    );

    assert.equal(ownerRequests.size, 1);
    await assertFails(getDoc(doc(otherDb, "orderRequests/request-1")));
    await assertSucceeds(getDoc(doc(adminDb, "orderRequests/request-1")));
  });

  it("allows Admin rejection with the required metadata and reason", async () => {
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertSucceeds(
      updateDoc(doc(adminDb, "orderRequests/request-1"), {
        status: "rejected",
        reviewedAt: serverTimestamp(),
        reviewedBy: "admin-1",
        rejectionReason: "Item unavailable",
      }),
    );

    const request = (await readSeeded("orderRequests/request-1")).data();
    assert.equal(request.status, "rejected");
    assert.equal(request.rejectionReason, "Item unavailable");
  });

  it("denies approval if the paired request and order fields do not match", async () => {
    const request = makeRequest();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const batch = makeApprovalBatch(adminDb, "request-1", request, {
      customerName: "Different Customer",
    });

    await assertFails(batch.commit());

    assert.equal((await readSeeded("orders/request-1")).exists(), false);
    assert.equal(
      (await readSeeded("orderRequests/request-1")).data().status,
      "pending",
    );
  });
});

describe("reservation permissions", () => {
  it("allows customers to create and read their reservation only", async () => {
    await seed("reservations/other-reservation", makeReservation("customer-2"));
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const ownReservation = makeReservation("customer-1");

    await assertSucceeds(
      setDoc(doc(customerDb, "reservations/own-reservation"), ownReservation),
    );
    await assertSucceeds(
      getDoc(doc(customerDb, "reservations/own-reservation")),
    );
    await assertFails(
      getDoc(doc(customerDb, "reservations/other-reservation")),
    );
    await assertFails(
      setDoc(
        doc(customerDb, "reservations/forged-reservation"),
        makeReservation("customer-2"),
      ),
    );

    assert.equal(
      (await readSeeded("reservations/forged-reservation")).exists(),
      false,
    );
  });

  it("allows Admin reservation listing and status management", async () => {
    await seed("reservations/admin-managed", makeReservation("customer-1"));
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    const reservations = await assertSucceeds(
      getDocs(collection(adminDb, "reservations")),
    );
    assert.equal(reservations.size, 1);
    await assertSucceeds(
      updateDoc(doc(adminDb, "reservations/admin-managed"), {
        status: "Confirmed",
      }),
    );
    await assertFails(
      updateDoc(doc(adminDb, "reservations/admin-managed"), {
        status: "Cancelled",
        notes: "Changed",
      }),
    );

    const reservation = (await readSeeded("reservations/admin-managed")).data();
    assert.equal(reservation.status, "Confirmed");
    assert.equal(reservation.notes, "");
  });
});

describe("private and public review permissions", () => {
  it("enforces private review ownership and allows Admin moderation", async () => {
    await seed("reviews/other-review", makePrivateReview("customer-2"));
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const otherDb = testEnv.authenticatedContext("customer-2").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertSucceeds(
      setDoc(
        doc(customerDb, "reviews/own-review"),
        makePrivateReview("customer-1"),
      ),
    );
    await assertSucceeds(getDoc(doc(customerDb, "reviews/own-review")));
    await assertFails(getDoc(doc(customerDb, "reviews/other-review")));
    await assertFails(
      getDoc(doc(otherDb, "reviews/own-review")),
    );
    await assertFails(
      updateDoc(doc(customerDb, "reviews/own-review"), {
        status: "Approved",
      }),
    );
    await assertFails(deleteDoc(doc(customerDb, "reviews/own-review")));
    assert.equal(
      (await readSeeded("reviews/own-review")).data().status,
      "Pending",
    );
    await assertSucceeds(
      updateDoc(doc(adminDb, "reviews/own-review"), {
        status: "Approved",
      }),
    );

    assert.equal(
      (await readSeeded("reviews/own-review")).data().status,
      "Approved",
    );
  });

  it("allows public review reads and Admin moderation writes only", async () => {
    await seed("publicReviews/existing-review", makePublicReview());
    const publicDb = testEnv.unauthenticatedContext().firestore();
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertSucceeds(
      getDoc(doc(publicDb, "publicReviews/existing-review")),
    );
    const publicReviews = await assertSucceeds(
      getDocs(collection(publicDb, "publicReviews")),
    );
    assert.equal(publicReviews.size, 1);

    await assertFails(
      setDoc(
        doc(customerDb, "publicReviews/customer-review"),
        makePublicReview(),
      ),
    );
    await assertFails(
      updateDoc(doc(customerDb, "publicReviews/existing-review"), {
        comment: "Changed",
      }),
    );
    await assertFails(
      deleteDoc(doc(customerDb, "publicReviews/existing-review")),
    );
    assert.equal(
      (await readSeeded("publicReviews/customer-review")).exists(),
      false,
    );
    assert.equal(
      (await readSeeded("publicReviews/existing-review")).data().comment,
      "Great coffee",
    );

    const adminReviewRef = doc(adminDb, "publicReviews/admin-review");
    await assertSucceeds(setDoc(adminReviewRef, makePublicReview()));
    await assertSucceeds(
      updateDoc(adminReviewRef, makePublicReview({ rating: 4 })),
    );
    await assertSucceeds(deleteDoc(adminReviewRef));
  });
});

describe("approval limits and duplicate protection", () => {
  it("allows a valid one-item paired Admin approval", async () => {
    const request = makeRequest();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertSucceeds(
      makeApprovalBatch(adminDb, "request-1", request).commit(),
    );

    const approvedRequest = (await readSeeded("orderRequests/request-1")).data();
    const order = (await readSeeded("orders/request-1")).data();
    assert.equal(approvedRequest.status, "approved");
    assert.equal(approvedRequest.orderId, "request-1");
    assert.equal(order.requestId, "request-1");
    assert.equal(order.items.length, 1);
  });

  it("allows a valid ten-item paired Admin approval", async () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      id: `item-${index + 1}`,
      quantity: 1,
    }));
    const request = makeRequest({ items });
    await seedPendingRequest("ten-item-request", request);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertSucceeds(
      makeApprovalBatch(adminDb, "ten-item-request", request).commit(),
    );

    const order = (await readSeeded("orders/ten-item-request")).data();
    assert.equal(order.items.length, 10);
    assert.equal(
      (await readSeeded("orderRequests/ten-item-request")).data().status,
      "approved",
    );
  });

  it("rejects a non-list or out-of-range order item list", async () => {
    const request = makeRequest();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const invalidLists = [
      "not-a-list",
      [],
      Array.from({ length: 11 }, (_, index) => ({
        id: `item-${index + 1}`,
        name: `Item ${index + 1}`,
        price: 1,
        quantity: 1,
        subtotal: 1,
      })),
    ];

    for (const [index, items] of invalidLists.entries()) {
      const batch = makeApprovalBatch(adminDb, "request-1", request, {
        items,
        total: items.length,
      });
      await assertFails(batch.commit());
      assert.equal((await readSeeded("orders/request-1")).exists(), false);
      assert.equal(
        (await readSeeded("orderRequests/request-1")).data().status,
        "pending",
        `request changed after invalid item list ${index + 1}`,
      );
    }
  });

  it("expects malformed individual order-line data to be rejected", async () => {
    const request = makeRequest();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const batch = makeApprovalBatch(adminDb, "request-1", request, {
      items: [{ id: "coffee", quantity: "two" }],
    });

    await assertFails(batch.commit());

    assert.equal((await readSeeded("orders/request-1")).exists(), false);
    assert.equal(
      (await readSeeded("orderRequests/request-1")).data().status,
      "pending",
    );
  });

  it("denies standalone request approval and leaves the pending request unchanged", async () => {
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const batch = writeBatch(adminDb);
    batch.update(doc(adminDb, "orderRequests/request-1"), {
      status: "approved",
      orderId: "request-1",
      reviewedAt: serverTimestamp(),
      reviewedBy: "admin-1",
    });

    await assertFails(batch.commit());

    assert.equal((await readSeeded("orders/request-1")).exists(), false);
    assert.equal(
      (await readSeeded("orderRequests/request-1")).data().status,
      "pending",
    );
  });

  it("denies approval when a matching order already exists without overwriting it", async () => {
    const request = makeRequest();
    await seedOrder("request-1", request);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const existingOrder = (await readSeeded("orders/request-1")).data();
    const batch = writeBatch(adminDb);
    batch.update(doc(adminDb, "orderRequests/request-1"), {
      status: "approved",
      orderId: "request-1",
      reviewedAt: serverTimestamp(),
      reviewedBy: "admin-1",
    });

    await assertFails(batch.commit());

    assert.equal(
      (await readSeeded("orderRequests/request-1")).data().status,
      "pending",
    );
    assert.deepEqual(
      (await readSeeded("orders/request-1")).data(),
      existingOrder,
    );
  });

  it("denies order creation for an already-approved request without an existing order", async () => {
    const request = makeRequest({
      status: "approved",
      orderId: "request-1",
      reviewedAt: Timestamp.fromDate(new Date("2025-01-02T00:00:00Z")),
      reviewedBy: "admin-1",
    });
    await seedPendingRequest("request-1", request);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const batch = writeBatch(adminDb);
    batch.set(
      doc(adminDb, "orders/request-1"),
      makeOrder(request, "request-1"),
    );

    await assertFails(batch.commit());

    assert.equal((await readSeeded("orders/request-1")).exists(), false);
    assert.equal(
      (await readSeeded("orderRequests/request-1")).data().status,
      "approved",
    );
  });
});
