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
} from "firebase/firestore";

const projectId = "demo-cactus-cafe-canonical-approval";
const rules = readFileSync(
  new URL("../firestore.rules.canonical-approval.optimized", import.meta.url),
  "utf8",
);

let testEnv;

function makeRequest(itemCount = 1) {
  return {
    customerId: "customer-1",
    customerEmail: "customer@example.test",
    customerName: "Cafe Customer",
    phone: "09123456789",
    items: Array.from({ length: itemCount }, (_, index) => ({
      id: `menu-${index + 1}`,
      quantity: index + 1,
    })),
    orderType: "takeout",
    address: "",
    notes: "No special instructions",
    status: "pending",
    createdAt: Timestamp.fromMillis(1700000000000),
  };
}

async function seedScenario({
  requestId = "request-1",
  itemCount = 1,
  migrationState = "ready",
  includePriceBook = true,
} = {}) {
  const request = makeRequest(itemCount);
  const menuItems = Object.fromEntries(
    request.items.map(({ id }, index) => [
      id,
      {
        name: `Menu item ${index + 1}`,
        price: (125 + index * 37) / 100,
        available: true,
        menuRevision: 1,
      },
    ]),
  );
  const prices = Object.fromEntries(
    Object.entries(menuItems).map(([id, menuItem]) => [
      id,
      {
        id,
        name: menuItem.name,
        priceCents: Math.round(menuItem.price * 100),
        available: menuItem.available,
        menuRevision: menuItem.menuRevision,
      },
    ]),
  );

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    const writes = [
      setDoc(doc(database, "users/admin-1"), { role: "admin" }),
      setDoc(doc(database, "users/customer-1"), { role: "customer" }),
      setDoc(doc(database, "users/customer-2"), { role: "customer" }),
      setDoc(doc(database, "menuControl/migration"), {
        state: migrationState,
        startedAt: Timestamp.fromMillis(1699999990000),
        updatedAt: Timestamp.fromMillis(1699999990000),
        updatedBy: "admin-1",
      }),
      setDoc(doc(database, `orderRequests/${requestId}`), request),
      ...Object.entries(menuItems).map(([id, menuItem]) =>
        setDoc(doc(database, `menuItems/${id}`), menuItem),
      ),
    ];
    if (includePriceBook) {
      writes.push(
        setDoc(doc(database, "menuControl/current"), {
          revision: 1,
          updatedAt: Timestamp.fromMillis(1699999990000),
          lastChangedMenuItemId: request.items[0]?.id || "seed",
          prices,
        }),
      );
    }
    await Promise.all(writes);
  });

  return { requestId, request, menuItems, prices };
}

function makeApprovalPatch(scenario, prices = scenario.prices) {
  const items = scenario.request.items.map(({ id, quantity }) => {
    const price = prices[id];
    return {
      id,
      name: scenario.menuItems[id].name,
      quantity,
      priceCents: price.priceCents,
    };
  });
  const totalCents = items.reduce(
    (total, item) => total + item.priceCents * item.quantity,
    0,
  );

  return {
    status: "approved",
    orderId: scenario.requestId,
    reviewedAt: serverTimestamp(),
    reviewedBy: "admin-1",
    approvedOrder: {
      items,
      totalCents,
      approvedAt: serverTimestamp(),
      priceBookRevision: 1,
    },
    orderStatus: "Pending",
  };
}

async function getStoredDocument(path) {
  let data = null;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const snapshot = await getDoc(doc(context.firestore(), path));
    data = snapshot.exists() ? snapshot.data() : null;
  });
  return data;
}

async function assertPermissionDenied(operation) {
  const error = await operation().then(
    () => null,
    (caughtError) => caughtError,
  );
  assert.ok(error instanceof Error, "Expected Firestore to deny the operation.");
  assert.equal(error.code, "permission-denied");
  return error;
}

async function assertDeniedWithoutMutation(requestId, operation) {
  const before = await getStoredDocument(`orderRequests/${requestId}`);
  const error = await assertPermissionDenied(operation);
  assert.doesNotMatch(
    error.message,
    /maximum of 1000 expressions|maximum.*access calls|unable to evaluate the expression|internal error/i,
  );
  const after = await getStoredDocument(`orderRequests/${requestId}`);
  assert.deepEqual(after, before);
}

async function approve(database, scenario, patch = makeApprovalPatch(scenario)) {
  await updateDoc(
    doc(database, `orderRequests/${scenario.requestId}`),
    patch,
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
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

describe("single-document canonical order approval", { concurrency: 1 }, () => {
  for (const itemCount of [1, 5, 10]) {
    it(`approves ${itemCount} item(s) within the rules expression budget`, async () => {
      const scenario = await seedScenario({ itemCount });
      const adminDb = testEnv.authenticatedContext("admin-1").firestore();

      await assertSucceeds(approve(adminDb, scenario));

      const approvedRequest = await getStoredDocument(
        `orderRequests/${scenario.requestId}`,
      );
      assert.equal(approvedRequest.status, "approved");
      assert.equal(approvedRequest.orderStatus, "Pending");
      assert.equal(approvedRequest.orderId, scenario.requestId);
      assert.equal(approvedRequest.reviewedBy, "admin-1");
      assert.deepEqual(approvedRequest.items, scenario.request.items);
      assert.equal(
        approvedRequest.approvedOrder.items.length,
        itemCount,
      );
      assert.equal(
        approvedRequest.approvedOrder.totalCents,
        scenario.request.items.reduce((total, item) => (
          total
          + scenario.prices[item.id].priceCents * item.quantity
        ), 0),
      );
      assert.deepEqual(
        approvedRequest.approvedOrder.items,
        scenario.request.items.map(({ id, quantity }) => ({
          id,
          name: scenario.menuItems[id].name,
          quantity,
          priceCents: scenario.prices[id].priceCents,
        })),
      );

      for (const [key, value] of Object.entries(scenario.request)) {
        if (key !== "status") {
          assert.deepEqual(approvedRequest[key], value);
        }
      }

      assert.equal(
        await getStoredDocument(`orders/${scenario.requestId}`),
        null,
      );
    });
  }

  it("denies a customer approval and leaves the request unchanged", async () => {
    const scenario = await seedScenario();
    const customerDb = testEnv.authenticatedContext("customer-1").firestore();
    const patch = {
      ...makeApprovalPatch(scenario),
      reviewedBy: "customer-1",
    };

    await assertDeniedWithoutMutation(
      scenario.requestId,
      () => approve(customerDb, scenario, patch),
    );
  });

  it("denies duplicate approval and leaves the approved request unchanged", async () => {
    const scenario = await seedScenario();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await approve(adminDb, scenario);

    await assertDeniedWithoutMutation(
      scenario.requestId,
      () => approve(adminDb, scenario),
    );
  });

  it("denies a snapshot priced against a superseded price book", async () => {
    const scenario = await seedScenario();
    const stalePatch = makeApprovalPatch(scenario);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      const menuItem = scenario.menuItems["menu-1"];
      const currentPriceCents = scenario.prices["menu-1"].priceCents + 100;
      const updatedMenuItem = {
        ...menuItem,
        price: currentPriceCents / 100,
        menuRevision: menuItem.menuRevision + 1,
      };
      const updatedPrices = {
        ...scenario.prices,
        "menu-1": {
          name: updatedMenuItem.name,
          priceCents: currentPriceCents,
          available: true,
          menuRevision: updatedMenuItem.menuRevision,
        },
      };

      await Promise.all([
        setDoc(doc(database, "menuItems/menu-1"), updatedMenuItem),
        setDoc(doc(database, "menuControl/current"), {
          revision: 2,
          updatedAt: Timestamp.fromMillis(1700000001000),
          lastChangedMenuItemId: "menu-1",
          prices: updatedPrices,
        }),
      ]);
    });
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertDeniedWithoutMutation(
      scenario.requestId,
      () => approve(adminDb, scenario, stalePatch),
    );
  });

  it("denies approval when a requested price-book item is unavailable", async () => {
    const scenario = await seedScenario();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, "menuControl/current"), {
        revision: 2,
        updatedAt: Timestamp.fromMillis(1700000001000),
        lastChangedMenuItemId: "menu-1",
        prices: {
          ...scenario.prices,
          "menu-1": {
            ...scenario.prices["menu-1"],
            available: false,
          },
        },
      });
    });
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertDeniedWithoutMutation(
      scenario.requestId,
      () => approve(adminDb, scenario),
    );
  });

  it("denies approval when the price-book document is missing", async () => {
    const scenario = await seedScenario({ includePriceBook: false });
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertDeniedWithoutMutation(
      scenario.requestId,
      () => approve(adminDb, scenario),
    );
  });

  it("denies approval when migration is not ready", async () => {
    const scenario = await seedScenario({ migrationState: "migrating" });
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertDeniedWithoutMutation(
      scenario.requestId,
      () => approve(adminDb, scenario),
    );
  });

  it("denies requests with more than ten items without changing them", async () => {
    const scenario = await seedScenario({ itemCount: 11 });
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertDeniedWithoutMutation(
      scenario.requestId,
      () => approve(adminDb, scenario),
    );
  });

  it("allows customers to read only their own request", async () => {
    const scenario = await seedScenario();
    const ownerDb = testEnv.authenticatedContext("customer-1").firestore();
    const otherCustomerDb = testEnv.authenticatedContext("customer-2").firestore();
    const adminDb = testEnv.authenticatedContext("admin-1").firestore();

    await assertSucceeds(
      getDoc(doc(ownerDb, `orderRequests/${scenario.requestId}`)),
    );
    await assertPermissionDenied(
      () => getDoc(doc(otherCustomerDb, `orderRequests/${scenario.requestId}`)),
    );
    await assertSucceeds(
      getDoc(doc(adminDb, `orderRequests/${scenario.requestId}`)),
    );
  });
});
