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
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  runTransaction,
} from "firebase/firestore";

const projectId = "demo-cactus-cafe-spark-approval";
const rules = readFileSync(
  new URL("../firestore.rules.spark-approval-prototype", import.meta.url),
  "utf8",
);

let testEnv;

const menuEntry = (overrides = {}) => ({
  name: "Coffee",
  price: 4.25,
  available: true,
  ...overrides,
});

function makeRequest(customerId = "customer-1", items = [
  { id: "menu-0", quantity: 2 },
]) {
  return {
    customerId,
    customerEmail: "customer@example.test",
    customerName: "Cafe Customer",
    phone: "09123456789",
    items,
    orderType: "takeout",
    address: "",
    notes: "Oat milk",
    status: "pending",
    createdAt: serverTimestamp(),
  };
}

function makeOrder(request, overrides = {}) {
  const items = request.items.map(({ id, quantity }, index) => {
    const price = id === "menu-0" ? 4.25 : index + 1;
    return {
      id,
      name: id === "menu-0" ? "Coffee" : `Menu ${index}`,
      price,
      quantity,
      subtotal: price * quantity,
    };
  });

  return {
    requestId: "request-1",
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

async function seedData({
  requestId = "request-1",
  request = makeRequest(),
  menuCount = 10,
  menuOverrides = {},
  seedRequest = true,
} = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const entries = {};
    const writes = [
      setDoc(doc(db, "users/admin-1"), { role: "admin" }),
      setDoc(doc(db, "users/customer-1"), { role: "customer" }),
      setDoc(doc(db, "users/customer-2"), { role: "customer" }),
    ];

    for (let index = 0; index < menuCount; index += 1) {
      const id = `menu-${index}`;
      const entry = menuEntry({
        name: index === 0 ? "Coffee" : `Menu ${index}`,
        price: index === 0 ? 4.25 : index + 1,
        ...menuOverrides[id],
      });
      entries[id] = entry;
      writes.push(setDoc(doc(db, `menuItems/${id}`), {
        ...entry,
        category: "Drinks",
        description: "Test menu item",
      }));
    }

    writes.push(setDoc(doc(db, "menuPricingCatalog/current"), {
      items: entries,
      lastUpdatedMenuItemId: "menu-0",
      lastUpdatedAt: Timestamp.now(),
    }));

    if (seedRequest) {
      writes.push(setDoc(doc(db, `orderRequests/${requestId}`), request));
    }

    await Promise.all(writes);
  });
}

async function approveWithTransaction(
  db,
  requestId = "request-1",
  orderFactory = makeOrder,
) {
  const requestRef = doc(db, `orderRequests/${requestId}`);
  const orderRef = doc(db, `orders/${requestId}`);

  return runTransaction(db, async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);
    if (!requestSnapshot.exists() || requestSnapshot.data().status !== "pending") {
      throw new Error("Request is no longer pending.");
    }
    const request = requestSnapshot.data();
    transaction.update(requestRef, {
      status: "approved",
      orderId: requestId,
      reviewedAt: serverTimestamp(),
      reviewedBy: "admin-1",
    });
    transaction.set(orderRef, orderFactory(request));
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
});

describe("menu pricing catalog synchronization", () => {
  it("allows an Admin to create a menu item with its catalog entry atomically", async () => {
    const db = testEnv.authenticatedContext("admin-1").firestore();
    const batch = writeBatch(db);
    const item = {
      ...menuEntry({ name: "New Coffee", price: 5.5 }),
      category: "Drinks",
      description: "New item",
    };

    batch.set(doc(db, "menuItems/new-menu-item"), item);
    batch.set(doc(db, "menuPricingCatalog/current"), {
      items: { "new-menu-item": menuEntry({ name: "New Coffee", price: 5.5 }) },
      lastUpdatedMenuItemId: "new-menu-item",
      lastUpdatedAt: serverTimestamp(),
    });

    await assertSucceeds(batch.commit());
  });

  it("allows an Admin to edit a menu item and catalog entry atomically", async () => {
    await seedData();
    const db = testEnv.authenticatedContext("admin-1").firestore();
    const batch = writeBatch(db);
    const catalogRef = doc(db, "menuPricingCatalog/current");
    const catalog = (await getDoc(catalogRef)).data();
    const updatedEntry = menuEntry({ name: "Updated Coffee", price: 6.25 });

    batch.update(doc(db, "menuItems/menu-0"), updatedEntry);
    batch.update(catalogRef, {
      items: { ...catalog.items, "menu-0": updatedEntry },
      lastUpdatedMenuItemId: "menu-0",
      lastUpdatedAt: serverTimestamp(),
    });

    await assertSucceeds(batch.commit());
  });

  it("allows an Admin to delete a menu item and its catalog entry atomically", async () => {
    await seedData();
    const db = testEnv.authenticatedContext("admin-1").firestore();
    const batch = writeBatch(db);
    const catalogRef = doc(db, "menuPricingCatalog/current");
    const catalog = (await getDoc(catalogRef)).data();
    const items = { ...catalog.items };
    delete items["menu-0"];

    batch.delete(doc(db, "menuItems/menu-0"));
    batch.update(catalogRef, {
      items,
      lastUpdatedMenuItemId: "menu-0",
      lastUpdatedAt: serverTimestamp(),
    });

    await assertSucceeds(batch.commit());
  });

  it("denies menu create, edit, and delete without catalog synchronization", async () => {
    await seedData();
    const db = testEnv.authenticatedContext("admin-1").firestore();

    await assertFails(
      setDoc(doc(db, "menuItems/unsynced-create"), menuEntry()),
    );
    await assertFails(
      updateDoc(doc(db, "menuItems/menu-0"), { price: 9 }),
    );
    await assertFails(deleteDoc(doc(db, "menuItems/menu-0")));
  });

  it("denies standalone catalog changes and mismatched catalog entries", async () => {
    await seedData();
    const db = testEnv.authenticatedContext("admin-1").firestore();
    const catalogRef = doc(db, "menuPricingCatalog/current");
    const catalog = (await getDoc(catalogRef)).data();

    await assertFails(updateDoc(catalogRef, {
      items: { ...catalog.items, "menu-0": menuEntry({ price: 99 }) },
      lastUpdatedMenuItemId: "menu-0",
      lastUpdatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(catalogRef, {
      lastUpdatedMenuItemId: "menu-0",
      lastUpdatedAt: serverTimestamp(),
    }));
  });
});

describe("customer order requests", () => {
  it("allows an authenticated customer to create their own pending request", async () => {
    await seedData({ seedRequest: false });
    const db = testEnv.authenticatedContext(
      "customer-1",
      { email: "customer@example.test" },
    ).firestore();

    await assertSucceeds(
      setDoc(doc(db, "orderRequests/customer-request"), makeRequest()),
    );
  });

  it("denies a customer request with another customer's ID", async () => {
    await seedData({ seedRequest: false });
    const db = testEnv.authenticatedContext(
      "customer-1",
      { email: "customer@example.test" },
    ).firestore();

    await assertFails(
      setDoc(
        doc(db, "orderRequests/forged-request"),
        makeRequest("customer-2"),
      ),
    );
  });
});

describe("Admin order approval", () => {
  it("allows valid atomic approval with one menu line", async () => {
    await seedData();
    const db = testEnv.authenticatedContext("admin-1").firestore();

    await assertSucceeds(approveWithTransaction(db));
    assert.equal(
      (await getDoc(doc(db, "orderRequests/request-1"))).data().status,
      "approved",
    );
    assert.equal(
      (await getDoc(doc(db, "orders/request-1"))).data().total,
      8.5,
    );
  });

  it("allows valid atomic approval with ten menu lines", async () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      id: `menu-${index}`,
      quantity: index + 1,
    }));
    await seedData({ request: makeRequest("customer-1", items) });
    const db = testEnv.authenticatedContext("admin-1").firestore();

    await assertSucceeds(approveWithTransaction(db));
    const order = (await getDoc(doc(db, "orders/request-1"))).data();
    assert.equal(order.items.length, 10);
    assert.equal(order.total, 330.5);
  });

  it("denies customer and non-Admin approval attempts", async () => {
    await seedData();
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const nonAdminDb = testEnv.authenticatedContext("customer-2").firestore();

    await assertFails(approveWithTransaction(customerDb));
    await assertFails(approveWithTransaction(nonAdminDb));
  });

  it("denies an approval using a stale price after the catalog price changes", async () => {
    await seedData();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(
        doc(context.firestore(), "menuPricingCatalog/current"),
        { "items.menu-0.price": 5 },
      );
    });
    const db = testEnv.authenticatedContext("admin-1").firestore();

    await assertFails(approveWithTransaction(db));
  });

  it("denies approval of an unavailable menu item", async () => {
    const request = makeRequest();
    await seedData({
      menuOverrides: { "menu-0": { available: false } },
      request,
    });
    const db = testEnv.authenticatedContext("admin-1").firestore();

    await assertFails(approveWithTransaction(db));
  });

  it("denies invalid requested quantities", async () => {
    await seedData({
      request: makeRequest("customer-1", [
        { id: "menu-0", quantity: 100 },
      ]),
    });
    const db = testEnv.authenticatedContext("admin-1").firestore();

    await assertFails(approveWithTransaction(db));
  });

  it("denies an incorrect item subtotal", async () => {
    await seedData();
    const db = testEnv.authenticatedContext("admin-1").firestore();

    await assertFails(approveWithTransaction(
      db,
      "request-1",
      (request) => makeOrder(request, {
        items: [{
          id: "menu-0",
          name: "Coffee",
          price: 4.25,
          quantity: 2,
          subtotal: 1,
        }],
      }),
    ));
  });

  it("denies an incorrect order total", async () => {
    await seedData();
    const db = testEnv.authenticatedContext("admin-1").firestore();

    await assertFails(approveWithTransaction(
      db,
      "request-1",
      (request) => makeOrder(request, { total: 999 }),
    ));
  });

  it("denies standalone order creation and standalone request approval", async () => {
    await seedData();
    const db = testEnv.authenticatedContext("admin-1").firestore();

    await assertFails(
      setDoc(
        doc(db, "orders/request-1"),
        makeOrder(makeRequest()),
      ),
    );
    await assertFails(
      updateDoc(doc(db, "orderRequests/request-1"), {
        status: "approved",
        orderId: "request-1",
        reviewedAt: serverTimestamp(),
        reviewedBy: "admin-1",
      }),
    );
  });

  it("denies duplicate and concurrent approvals from creating duplicate orders", async () => {
    await seedData();
    const db = testEnv.authenticatedContext("admin-1").firestore();

    await assertSucceeds(approveWithTransaction(db));
    await assertFails(approveWithTransaction(db));
    const attempts = await Promise.allSettled([
      approveWithTransaction(db),
      approveWithTransaction(db),
    ]);

    assert.equal(
      attempts.filter((result) => result.status === "fulfilled").length,
      0,
    );
    assert.equal(
      attempts.filter((result) => result.status === "rejected").length,
      2,
    );
    const orders = await getDocs(collection(db, "orders"));
    assert.equal(orders.size, 1);
  });
});

describe("preserved access and unrelated rules", () => {
  it("restricts order reads to the owner or an Admin and allows Admin status updates", async () => {
    await seedData();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "orders/existing-order"), {
        customerId: "customer-1",
        status: "Pending",
      });
    });
    const ownerDb = testEnv.authenticatedContext("customer-1").firestore();
    const otherDb = testEnv.authenticatedContext("customer-2").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertSucceeds(getDoc(doc(ownerDb, "orders/existing-order")));
    await assertFails(getDoc(doc(otherDb, "orders/existing-order")));
    await assertSucceeds(
      updateDoc(doc(adminDb, "orders/existing-order"), {
        status: "Confirmed",
      }),
    );
    await assertFails(
      updateDoc(doc(ownerDb, "orders/existing-order"), {
        status: "Confirmed",
      }),
    );
  });

  it("preserves public review reads and Admin-only validated moderation", async () => {
    const review = {
      rating: 5,
      comment: "Great coffee",
      createdAt: Timestamp.now(),
      displayName: "Cactus Café Customer",
    };
    const anonymousDb = testEnv.unauthenticatedContext().firestore();
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertSucceeds(setDoc(
      doc(adminDb, "publicReviews/review-1"),
      review,
    ));
    await assertSucceeds(getDoc(doc(anonymousDb, "publicReviews/review-1")));
    await assertFails(setDoc(
      doc(customerDb, "publicReviews/customer-review"),
      review,
    ));
    await assertFails(setDoc(
      doc(adminDb, "publicReviews/invalid-review"),
      { ...review, rating: 6 },
    ));
  });

  it("preserves public menu reads and Admin-only menu writes", async () => {
    await seedData();
    const visitorDb = testEnv.unauthenticatedContext().firestore();
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertSucceeds(getDoc(doc(visitorDb, "menuItems/menu-0")));
    await assertFails(setDoc(
      doc(customerDb, "menuItems/customer-item"),
      menuEntry(),
    ));
    await assertFails(setDoc(
      doc(adminDb, "menuItems/admin-item-without-catalog"),
      menuEntry(),
    ));
  });
});
