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
  updateDoc,
} from "firebase/firestore";

const projectId = "demo-cactus-cafe-delivery-settings";
const rules = readFileSync(
  new URL("../firestore.rules", import.meta.url),
  "utf8",
);

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId, firestore: { rules } });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users/admin-1"), { role: "admin" });
  });
});

after(async () => {
  await testEnv.cleanup();
});

describe("Sunday delivery setting rules", () => {
  it("allows public reads of only the delivery setting document", async () => {
    const database = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(database, "cafeSettings", "delivery")));
    await assertFails(getDocs(collection(database, "cafeSettings")));
  });

  it("allows an admin to create and update a valid setting", async () => {
    const database = testEnv.authenticatedContext("admin-1").firestore();
    const settingRef = doc(database, "cafeSettings", "delivery");

    await assertSucceeds(setDoc(settingRef, {
      disableSundayDelivery: false,
      updatedAt: serverTimestamp(),
      updatedBy: "admin-1",
    }));
    await assertSucceeds(updateDoc(settingRef, {
      disableSundayDelivery: true,
      updatedAt: serverTimestamp(),
      updatedBy: "admin-1",
    }));
  });

  it("rejects customer writes and malformed settings", async () => {
    const customerDatabase = testEnv.authenticatedContext("customer-1").firestore();
    const customerSettingRef = doc(customerDatabase, "cafeSettings", "delivery");
    await assertFails(setDoc(customerSettingRef, {
      disableSundayDelivery: true,
      updatedAt: serverTimestamp(),
      updatedBy: "customer-1",
    }));

    const adminDatabase = testEnv.authenticatedContext("admin-1").firestore();
    const adminSettingRef = doc(adminDatabase, "cafeSettings", "delivery");
    await assertFails(setDoc(adminSettingRef, {
      disableSundayDelivery: "true",
      updatedAt: serverTimestamp(),
      updatedBy: "admin-1",
    }));
    await assertFails(deleteDoc(adminSettingRef));
  });
});
