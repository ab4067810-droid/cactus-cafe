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
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

const stages = [
  {
    name: "stage 1: admin and request ID",
    rulesFile: "../firestore.rules.diagnostic.stage1",
    directCreateSucceeds: true,
  },
  {
    name: "stage 2: request exists and is pending",
    rulesFile: "../firestore.rules.diagnostic.stage2",
    directCreateSucceeds: true,
  },
  {
    name: "stage 3: after-state approval",
    rulesFile: "../firestore.rules.diagnostic.stage3",
    directCreateSucceeds: false,
  },
  {
    name: "stage 4: full order/request validation",
    rulesFile: "../firestore.rules.diagnostic.stage4",
    directCreateSucceeds: false,
  },
];

const validationVariants = [
  {
    name: "field matching only",
    rulesFile: "../firestore.rules.diagnostic.field-matching",
  },
  {
    name: "item validation without total",
    rulesFile: "../firestore.rules.diagnostic.item-validation",
  },
  {
    name: "total validation without item loop",
    rulesFile: "../firestore.rules.diagnostic.total-validation",
  },
];

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
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

function makeOrder(request, requestId, overrides = {}) {
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

for (const [index, stage] of stages.entries()) {
  describe(stage.name, () => {
    const projectId = `demo-cactus-order-create-stage-${index + 1}`;
    const rules = readFileSync(new URL(stage.rulesFile, import.meta.url), "utf8");
    let env;

    before(async () => {
      env = await initializeTestEnvironment({
        projectId,
        firestore: { rules },
      });
    });

    beforeEach(async () => {
      await env.clearFirestore();
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await Promise.all([
          setDoc(doc(db, "users/admin-1"), { role: "admin" }),
          setDoc(doc(db, "users/customer-1"), { role: "customer" }),
          setDoc(doc(db, "users/customer-2"), { role: "customer" }),
          setDoc(doc(db, "orderRequests/request-1"), makeRequest()),
        ]);
      });
    });

    after(async () => {
      await env.cleanup();
    });

    it("records the direct order-only result", async () => {
      const request = makeRequest({
        createdAt: undefined,
      });
      delete request.createdAt;
      request.createdAt = serverTimestamp();
      const adminDb = env.authenticatedContext("admin-1").firestore();
      const operation = setDoc(
        doc(adminDb, "orders/request-1"),
        makeOrder(request, "request-1"),
      );

      if (stage.directCreateSucceeds) {
        await assertSucceeds(operation);
      } else {
        await assertFails(operation);
      }
    });

    if (index === 3) {
      it("records legitimate one-item approval", async () => {
        const request = makeRequest();
        await env.withSecurityRulesDisabled(async (context) => {
          await setDoc(
            doc(context.firestore(), "orderRequests/request-1"),
            request,
          );
        });
        const adminDb = env.authenticatedContext("admin-1").firestore();
        const batch = writeBatch(adminDb);
        batch.update(doc(adminDb, "orderRequests/request-1"), {
          status: "approved",
          orderId: "request-1",
          reviewedAt: serverTimestamp(),
          reviewedBy: "admin-1",
        });
        batch.set(
          doc(adminDb, "orders/request-1"),
          makeOrder(request, "request-1"),
        );
        await assertSucceeds(batch.commit());
      });

      it("records legitimate ten-item approval", async () => {
        const request = makeRequest({
          items: Array.from({ length: 10 }, (_, itemIndex) => ({
            id: `item-${itemIndex}`,
            quantity: itemIndex + 1,
          })),
        });
        await env.withSecurityRulesDisabled(async (context) => {
          await setDoc(
            doc(context.firestore(), "orderRequests/request-1"),
            request,
          );
        });
        const adminDb = env.authenticatedContext("admin-1").firestore();
        const batch = writeBatch(adminDb);
        batch.update(doc(adminDb, "orderRequests/request-1"), {
          status: "approved",
          orderId: "request-1",
          reviewedAt: serverTimestamp(),
          reviewedBy: "admin-1",
        });
        batch.set(
          doc(adminDb, "orders/request-1"),
          makeOrder(request, "request-1"),
        );
        await assertSucceeds(batch.commit());
      });

      it("records customer approval denial", async () => {
        const request = makeRequest();
        const customerDb = env.authenticatedContext("customer-1").firestore();
        const batch = writeBatch(customerDb);
        batch.update(doc(customerDb, "orderRequests/request-1"), {
          status: "approved",
          orderId: "request-1",
          reviewedAt: serverTimestamp(),
          reviewedBy: "customer-1",
        });
        batch.set(
          doc(customerDb, "orders/request-1"),
          makeOrder(request, "request-1"),
        );
        await assertFails(batch.commit());
      });

      it("records changed-customer-details denial", async () => {
        const changedRequest = makeRequest({
          customerId: "customer-2",
          customerEmail: "other@example.test",
          customerName: "Different Customer",
        });
        const adminDb = env.authenticatedContext("admin-1").firestore();
        const batch = writeBatch(adminDb);
        batch.update(doc(adminDb, "orderRequests/request-1"), {
          customerId: changedRequest.customerId,
          customerEmail: changedRequest.customerEmail,
          customerName: changedRequest.customerName,
          status: "approved",
          orderId: "request-1",
          reviewedAt: serverTimestamp(),
          reviewedBy: "admin-1",
        });
        batch.set(
          doc(adminDb, "orders/request-1"),
          makeOrder(changedRequest, "request-1"),
        );
        await assertFails(batch.commit());
      });
    }

  });
}

for (const [index, variant] of validationVariants.entries()) {
  describe(`Stage 4 isolated ${variant.name}`, () => {
    const projectId = `demo-cactus-order-validation-${index + 1}`;
    const rules = readFileSync(
      new URL(variant.rulesFile, import.meta.url),
      "utf8",
    );
    let env;

    before(async () => {
      env = await initializeTestEnvironment({
        projectId,
        firestore: { rules },
      });
    });

    beforeEach(async () => {
      await env.clearFirestore();
      await env.withSecurityRulesDisabled(async (context) => {
        await Promise.all([
          setDoc(doc(context.firestore(), "users/admin-1"), {
            role: "admin",
          }),
          setDoc(
            doc(context.firestore(), "orderRequests/request-1"),
            makeRequest(),
          ),
        ]);
      });
    });

    after(async () => {
      await env.cleanup();
    });

    for (const itemCount of [1, 10]) {
      it(`validation variant approves a legitimate ${itemCount}-item order`, async () => {
        const request = makeRequest({
          items: Array.from({ length: itemCount }, (_, itemIndex) => ({
            id: `item-${itemIndex}`,
            quantity: itemIndex + 1,
          })),
        });
        await env.withSecurityRulesDisabled(async (context) => {
          await setDoc(
            doc(context.firestore(), "orderRequests/request-1"),
            request,
          );
        });

        const adminDb = env.authenticatedContext("admin-1").firestore();
        const batch = writeBatch(adminDb);
        batch.update(doc(adminDb, "orderRequests/request-1"), {
          status: "approved",
          orderId: "request-1",
          reviewedAt: serverTimestamp(),
          reviewedBy: "admin-1",
        });
        batch.set(
          doc(adminDb, "orders/request-1"),
          makeOrder(request, "request-1"),
        );
        await assertSucceeds(batch.commit());
      });
    }
  });
}
