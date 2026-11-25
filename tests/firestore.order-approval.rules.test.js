import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
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
  writeBatch,
} from "firebase/firestore";

import {
  approveOrderRequest,
  updateQrOrderPaymentStatus,
} from "../src/services/orderApprovalService.js";
import { getApprovalPricing } from "../src/utils/approvalPricing.js";
import { getOrderApprovalPricing } from "../src/utils/deliveryFees.js";

const projectId = "demo-cactus-cafe-order-approval";
const rules = readFileSync(
  new URL("../firestore.rules", import.meta.url),
  "utf8",
);

let testEnv;

function makeRequest(overrides = {}) {
  const request = {
    customerId: "customer-1",
    customerEmail: "customer@example.test",
    customerName: "Cafe Customer",
    phone: "09123456789",
    items: [{ id: "coffee", quantity: 2 }],
    orderType: "takeout",
    address: "12 Main Street, Barangay 1 Poblacion",
    notes: "Oat milk",
    status: "pending",
    createdAt: serverTimestamp(),
    ...overrides,
  };
  if (request.orderType === "delivery") {
    request.deliveryBarangay ||= "Barangay 1 Poblacion";
    request.deliveryFee ??= 20;
  }
  return request;
}

function makeOrder(request, requestId, overrides = {}) {
  const items = request.items.map(({ id, quantity }) => ({
    id,
    name: "Coffee",
    price: 4,
    quantity,
    subtotal: 4 * quantity,
  }));
  const itemsSubtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  return {
    requestId,
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

function confirmedPricing(request, menuItems = {
  coffee: { name: "Coffee", price: 4, available: true },
}) {
  return getOrderApprovalPricing(
    request,
    new Map(Object.entries(menuItems)),
    getApprovalPricing,
  );
}

async function seedApprovalState(menuItems = {
  coffee: {
    name: "Coffee",
    price: 4,
    available: true,
    menuRevision: 1,
  },
}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const timestamp = Timestamp.fromMillis(1000);
    const prices = Object.fromEntries(
      Object.entries(menuItems).map(([id, item]) => [
        id,
        {
          priceCents: Math.round(item.price * 100),
          available: item.available,
          menuRevision: item.menuRevision,
          ...(item.sizes
            ? {
                sizePricesCents: Object.fromEntries(
                  Object.entries(item.sizes).map(([size, price]) => [
                    size,
                    Math.round(price * 100),
                  ]),
                ),
              }
            : {}),
        },
      ]),
    );
    await Promise.all([
      ...Object.entries(menuItems).map(([id, item]) => (
        setDoc(doc(db, `menuItems/${id}`), item)
      )),
      setDoc(doc(db, "menuControl/migration"), {
        state: "ready",
        startedAt: timestamp,
        updatedAt: timestamp,
        updatedBy: "admin-1",
      }),
      setDoc(doc(db, "menuControl/current"), {
        revision: 1,
        updatedAt: timestamp,
        lastChangedMenuItemId: Object.keys(menuItems)[0],
        prices,
      }),
    ]);
  });
}

async function seedRequest(requestId, request) {
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

async function createCustomerRequest(
  database,
  requestId,
  request,
  selectionOverrides = {},
) {
  const batch = writeBatch(database);
  batch.set(doc(database, `orderRequests/${requestId}`), request);
  batch.set(doc(database, `paymentSelections/${requestId}`), {
    requestId,
    customerId: request.customerId,
    method: "cash",
    timing: "pay_later",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...selectionOverrides,
  });
  await batch.commit();
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
    /maximum of 1000 expressions|unable to evaluate the expression|maximum of 10 document access calls|maximum of 20 document access calls/i,
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
      setDoc(doc(db, "users/customer-1"), { role: "customer" }),
      setDoc(doc(db, "users/customer-2"), { role: "customer" }),
      setDoc(doc(db, "users/admin-1"), { role: "admin" }),
      setDoc(doc(db, "users/staff-1"), { role: "staff" }),
    ]);
  });
});

describe("order approval rules", () => {
  it("allows customer profile pins only within Isabela", async () => {
    const customerDb = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    const profileRef = doc(customerDb, "users/customer-1");

    await assertSucceeds(
      updateDoc(profileRef, {
        deliveryAddress: {
          deliveryLocation: { lat: 10.2054, lng: 122.9882 },
        },
      }),
    );
    await assertSucceeds(
      updateDoc(profileRef, {
        deliveryAddress: { deliveryLocation: null },
      }),
    );
    await assertDeniedWithoutRuleLimitError(
      updateDoc(profileRef, {
        deliveryAddress: {
          deliveryLocation: { lat: 10.3, lng: 122.9882 },
        },
      }),
    );
  });

  it("allows an admin to atomically approve a valid request and create its matching order", async () => {
    await seedApprovalState();
    const requestId = "valid-request";
    const request = makeRequest();
    const customerDb = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    await assertSucceeds(createCustomerRequest(customerDb, requestId, request));

    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const result = await approveOrderRequest(
      adminDb,
      requestId,
      "admin-1",
      confirmedPricing(request),
    );
    const approvedRequest = await getDoc(
      doc(adminDb, `orderRequests/${requestId}`),
    );
    const order = await getDoc(doc(adminDb, `orders/${requestId}`));

    assert.equal(result.error, undefined);
    assert.equal(approvedRequest.data().status, "approved");
    assert.equal(approvedRequest.data().customerId, request.customerId);
    assert.equal(approvedRequest.data().reviewedBy, "admin-1");
    assert.equal(order.exists(), true);
    assert.equal(order.data().customerId, request.customerId);
    assert.equal(order.data().requestId, requestId);
    assert.equal(order.data().customerName, request.customerName);
    assert.deepEqual(
      order.data().items.map(({ id, quantity }) => ({ id, quantity })),
      request.items,
    );
    assert.equal(order.data().total, confirmedPricing(request).total);
  });

  it("carries a submitted GCash reference and compressed receipt onto the order", async () => {
    await seedApprovalState();
    const requestId = "gcash-proof-request";
    const request = makeRequest();
    const paymentProofUrl = "data:image/jpeg;base64,SGVsbG8=";
    const customerDb = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    await assertSucceeds(createCustomerRequest(
      customerDb,
      requestId,
      request,
      {
        method: "qr",
        timing: "advance",
        paymentReference: "1234567890123",
        paymentProofUrl,
        paymentStatus: "pending_verification",
      },
    ));

    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const result = await approveOrderRequest(
      adminDb,
      requestId,
      "admin-1",
      confirmedPricing(request),
    );
    const order = await getDoc(doc(adminDb, `orders/${requestId}`));

    assert.equal(result.error, undefined);
    assert.equal(order.data().paymentMethod, "qr");
    assert.equal(order.data().paymentReference, "1234567890123");
    assert.equal(order.data().paymentProofUrl, paymentProofUrl);
    assert.equal(order.data().paymentStatus, "pending_verification");

    const staffDb = testEnv.authenticatedContext("staff-1").firestore();
    await updateQrOrderPaymentStatus(
      staffDb,
      requestId,
      "staff-1",
      "needs_review",
    );
    const needsReviewOrder = await getDoc(doc(staffDb, `orders/${requestId}`));
    assert.equal(needsReviewOrder.data().paymentStatus, "needs_review");
    assert.equal(needsReviewOrder.data().paymentStatusUpdatedBy, "staff-1");

    await updateQrOrderPaymentStatus(
      adminDb,
      requestId,
      "admin-1",
      "paid",
    );
    const verifiedOrder = await getDoc(doc(adminDb, `orders/${requestId}`));
    assert.equal(verifiedOrder.data().paymentStatus, "paid");
    assert.equal(verifiedOrder.data().paymentStatusUpdatedBy, "admin-1");
  });

  it("accepts and carries a delivery pin through request approval", async () => {
    await seedApprovalState();
    const requestId = "delivery-pin-request";
    const deliveryLocation = { lat: 10.2054, lng: 122.9882 };
    const request = makeRequest({
      orderType: "delivery",
      address: "12 Purok 2, Barangay 1 (Poblacion), Isabela, Negros Occidental",
      deliveryLocation,
    });
    const customerDb = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    await assertSucceeds(createCustomerRequest(customerDb, requestId, request));

    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const result = await approveOrderRequest(
      adminDb,
      requestId,
      "admin-1",
      confirmedPricing(request),
    );
    const order = await getDoc(doc(adminDb, `orders/${requestId}`));

    assert.equal(result.error, undefined);
    assert.deepEqual(order.data().deliveryLocation, deliveryLocation);
  });

  it("accepts a cleared delivery pin and rejects coordinates outside Isabela", async () => {
    await seedApprovalState();
    const customerDb = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    const request = makeRequest({
      orderType: "delivery",
      address: "12 Purok 2, Barangay 1 (Poblacion), Isabela, Negros Occidental",
      deliveryLocation: null,
    });
    await assertSucceeds(
      createCustomerRequest(customerDb, "cleared-delivery-pin", request),
    );

    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const result = await approveOrderRequest(
      adminDb,
      "cleared-delivery-pin",
      "admin-1",
      confirmedPricing(request),
    );
    const order = await getDoc(
      doc(adminDb, "orders/cleared-delivery-pin"),
    );

    assert.equal(result.error, undefined);
    assert.equal(order.data().deliveryLocation, null);
    await assertDeniedWithoutRuleLimitError(
      setDoc(
        doc(customerDb, "orderRequests/outside-isabela-pin"),
        makeRequest({
          orderType: "delivery",
          address: "Outside Isabela",
          deliveryLocation: { lat: 10.3, lng: 122.9882 },
        }),
      ),
    );
  });

  it("approves a valid request with ten item lines within rule limits", async () => {
    const menuItems = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => {
        const id = `menu-${index + 1}`;
        return [
          id,
          {
            name: `Menu item ${index + 1}`,
            price: index + 1,
            available: true,
            menuRevision: 1,
          },
        ];
      }),
    );
    const request = makeRequest({
      items: Object.keys(menuItems).map((id, index) => ({
        id,
        quantity: index + 1,
      })),
      orderType: "delivery",
      address: "12 Purok 2, Barangay 1 (Poblacion), Isabela, Negros Occidental",
      deliveryLocation: { lat: 10.2054, lng: 122.9882 },
    });
    const requestId = "ten-line-request";
    await seedApprovalState(menuItems);

    const customerDb = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    await assertSucceeds(createCustomerRequest(customerDb, requestId, request));

    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const result = await approveOrderRequest(
      adminDb,
      requestId,
      "admin-1",
      confirmedPricing(request, menuItems),
    );
    const order = await getDoc(doc(adminDb, `orders/${requestId}`));

    assert.equal(result.error, undefined);
    assert.equal(order.exists(), true);
    assert.equal(order.data().items.length, 10);
    assert.deepEqual(
      order.data().items.map(({ id, quantity }) => ({ id, quantity })),
      request.items,
    );
    assert.deepEqual(order.data().deliveryLocation, request.deliveryLocation);
  });

  it("approves separate size lines for the same menu item at their size prices", async () => {
    const menuItems = {
      "milk-tea": {
        name: "Milk Tea",
        price: 5,
        sizes: { "8oz": 5, "12oz": 7.25, "16oz": 9 },
        available: true,
        menuRevision: 1,
      },
    };
    const request = makeRequest({
      items: [
        { id: "milk-tea", quantity: 1, size: "12oz" },
        { id: "milk-tea", quantity: 2, size: "16oz" },
      ],
    });
    const requestId = "sized-drink-request";
    await seedApprovalState(menuItems);

    const customerDb = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    await assertSucceeds(createCustomerRequest(customerDb, requestId, request));

    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const confirmation = confirmedPricing(request, {
      "milk-tea": {
        ...menuItems["milk-tea"],
        sizePricesCents: {
          "8oz": 500,
          "12oz": 725,
          "16oz": 900,
        },
      },
    });
    const result = await approveOrderRequest(
      adminDb,
      requestId,
      "admin-1",
      confirmation,
    );
    const order = await getDoc(doc(adminDb, `orders/${requestId}`));

    assert.equal(result.error, undefined);
    assert.equal(order.exists(), true);
    assert.equal(order.data().total, 25.25);
    assert.deepEqual(order.data().items, confirmation.orderItems);
    assert.deepEqual(
      order.data().items.map(({ name, price, size }) => ({ name, price, size })),
      [
        { name: "Milk Tea (12oz)", price: 7.25, size: "12oz" },
        { name: "Milk Tea (16oz)", price: 9, size: "16oz" },
      ],
    );
  });

  it("denies customer approval and direct customer order creation", async () => {
    await seedApprovalState();
    const requestId = "customer-request";
    const request = makeRequest();
    const customerDb = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    await assertSucceeds(createCustomerRequest(customerDb, requestId, request));

    const approval = writeBatch(customerDb);
    approval.update(doc(customerDb, `orderRequests/${requestId}`), {
      status: "approved",
      orderId: requestId,
      reviewedAt: serverTimestamp(),
      reviewedBy: "customer-1",
    });
    approval.set(
      doc(customerDb, `orders/${requestId}`),
      makeOrder(request, requestId),
    );
    await assertDeniedWithoutRuleLimitError(approval.commit());

    const serviceResult = await approveOrderRequest(
      customerDb,
      requestId,
      "customer-1",
      confirmedPricing(request),
    );
    assert.equal(serviceResult.error?.code, "permission-denied");
    assert.equal(
      (await getDoc(doc(customerDb, `orderRequests/${requestId}`))).data().status,
      "pending",
    );

    await assertDeniedWithoutRuleLimitError(
      setDoc(
        doc(customerDb, "orders/arbitrary-confirmed-order"),
        makeOrder(request, "arbitrary-confirmed-order", {
          total: 0,
          status: "Completed",
        }),
      ),
    );
  });

  it("rejects malformed or non-pending requests without creating an order", async () => {
    await seedApprovalState();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const customerDb = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    await assertDeniedWithoutRuleLimitError(
      setDoc(
        doc(customerDb, "orderRequests/malformed-request"),
        makeRequest({ phone: 12345 }),
      ),
    );

    const nonPendingRequestId = "non-pending-request";
    const nonPendingRequest = makeRequest({ status: "rejected" });
    await seedRequest(nonPendingRequestId, nonPendingRequest);
    const nonPendingResult = await approveOrderRequest(
      adminDb,
      nonPendingRequestId,
      "admin-1",
      confirmedPricing(nonPendingRequest),
    );
    assert.equal(nonPendingResult.error?.code, "failed-precondition");
    const nonPendingBatch = writeBatch(adminDb);
    nonPendingBatch.update(
      doc(adminDb, `orderRequests/${nonPendingRequestId}`),
      {
        status: "approved",
        orderId: nonPendingRequestId,
        reviewedAt: serverTimestamp(),
        reviewedBy: "admin-1",
      },
    );
    nonPendingBatch.set(
      doc(adminDb, `orders/${nonPendingRequestId}`),
      makeOrder(nonPendingRequest, nonPendingRequestId),
    );
    await assertDeniedWithoutRuleLimitError(nonPendingBatch.commit());
    assert.equal(
      (await getDoc(doc(adminDb, `orderRequests/${nonPendingRequestId}`))).data().status,
      "rejected",
    );
    assert.equal(
      (await getDoc(doc(adminDb, `orders/${nonPendingRequestId}`))).exists(),
      false,
    );
  });

  it("rejects an order whose customer or requested items do not match", async () => {
    await seedApprovalState();
    const requestId = "mismatched-order";
    const request = makeRequest();
    const customerDb = testEnv
      .authenticatedContext("customer-1", { email: "customer@example.test" })
      .firestore();
    await assertSucceeds(createCustomerRequest(customerDb, requestId, request));

    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const batch = writeBatch(adminDb);
    batch.update(doc(adminDb, `orderRequests/${requestId}`), {
      status: "approved",
      orderId: requestId,
      reviewedAt: serverTimestamp(),
      reviewedBy: "admin-1",
    });
    batch.set(
      doc(adminDb, `orders/${requestId}`),
      makeOrder(request, requestId, {
        customerId: "customer-2",
        items: [{
          id: "tea",
          name: "Tea",
          price: 4,
          quantity: 2,
          subtotal: 8,
        }],
      }),
    );

    await assertDeniedWithoutRuleLimitError(batch.commit());
    assert.equal(
      (await getDoc(doc(adminDb, `orderRequests/${requestId}`))).data().status,
      "pending",
    );
    assert.equal(
      (await getDoc(doc(adminDb, `orders/${requestId}`))).exists(),
      false,
    );
  });

  it("rejects approval when an order already exists for the request ID", async () => {
    await seedApprovalState();
    const requestId = "pre-existing-order";
    const request = makeRequest();
    await seedRequest(requestId, request);
    const existingOrder = makeOrder(request, requestId, {
      customerId: "customer-2",
      items: [{
        id: "tea",
        name: "Tea",
        price: 4,
        quantity: 2,
        subtotal: 8,
      }],
    });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), `orders/${requestId}`),
        existingOrder,
      );
    });

    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    const batch = writeBatch(adminDb);
    batch.update(doc(adminDb, `orderRequests/${requestId}`), {
      status: "approved",
      orderId: requestId,
      reviewedAt: serverTimestamp(),
      reviewedBy: "admin-1",
    });

    await assertDeniedWithoutRuleLimitError(batch.commit());
    assert.equal(
      (await getDoc(doc(adminDb, `orderRequests/${requestId}`))).data().status,
      "pending",
    );
    const persistedOrder = (
      await getDoc(doc(adminDb, `orders/${requestId}`))
    ).data();
    assert.equal(persistedOrder.customerId, existingOrder.customerId);
    assert.deepEqual(
      persistedOrder.items.map(({ id, quantity }) => ({ id, quantity })),
      existingOrder.items.map(({ id, quantity }) => ({ id, quantity })),
    );
  });

  it("does not allow an admin to create an order without the paired approval", async () => {
    await seedApprovalState();
    const requestId = "unpaired-order";
    const request = makeRequest();
    await seedRequest(requestId, request);
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertDeniedWithoutRuleLimitError(
      setDoc(
        doc(adminDb, `orders/${requestId}`),
        makeOrder(request, requestId),
      ),
    );
  });
});
