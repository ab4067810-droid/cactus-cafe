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
} from "firebase/firestore";
import {
  blockPhone,
  isPhoneBlocked,
  listBlockedPhones,
  unblockPhone,
} from "../src/services/blockedPhoneService.js";
import {
  claimPhoneForUser,
  saveCustomerProfileWithPhone,
} from "../src/services/phoneRegistryService.js";
import {
  createPhoneRestorationRequest,
  getCustomerPhoneRestorationRequests,
  listPhoneRestorationRequests,
  resolvePhoneRestorationRequest,
} from "../src/services/phoneRestorationService.js";

const projectId = "demo-cactus-cafe-phone-registry";
const rules = readFileSync(
  new URL("../firestore.rules", import.meta.url),
  "utf8",
);
const normalizedPhone = "09171234567";
const otherPhone = "09181234567";

let testEnv;

const makeRequest = (overrides = {}) => ({
  customerId: "customer-1",
  customerEmail: "customer@example.test",
  customerName: "Cafe Customer",
  phone: normalizedPhone,
  items: [{ id: "coffee", quantity: 1 }],
  orderType: "takeout",
  address: "12 Main Street, Isabela, Negros Occidental",
  notes: "",
  status: "pending",
  createdAt: serverTimestamp(),
  ...overrides,
});

const makeReservation = (overrides = {}) => ({
  userId: "customer-1",
  customerEmail: "customer@example.test",
  customerName: "Cafe Customer",
  phone: normalizedPhone,
  date: "2026-12-01",
  time: "18:00",
  guests: 2,
  notes: "",
  status: "Pending",
  createdAt: serverTimestamp(),
  perHeadRate: 50,
  totalReservationFee: 100,
  selectedPaymentOption: "full",
  amountPaidNow: 100,
  remainingBalance: 0,
  paymentMethod: "qr",
  paymentReference: "TESTREF001",
  paymentProofUrl: "data:image/jpeg;base64,/9j/2Q==",
  paymentStatus: "pending_review",
  ...overrides,
});

const createReservationWithReference = async (
  database,
  path,
  reservation,
) => {
  const batch = writeBatch(database);
  batch.set(
    doc(database, `paymentReferences/${reservation.paymentReference}`),
    {
      normalizedReference: reservation.paymentReference,
      sourceType: "reservation",
      createdBy: reservation.userId,
      createdAt: serverTimestamp(),
    },
  );
  batch.set(doc(database, path), reservation);
  await batch.commit();
};

const seedBlockedCustomerPhone = async (customerUid = "customer-1") => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, `users/${customerUid}`), {
        role: "customer",
        phone: normalizedPhone,
        phoneNumber: normalizedPhone,
      }),
      setDoc(doc(database, `blockedPhones/${normalizedPhone}`), {
        phone: normalizedPhone,
        phoneNumber: normalizedPhone,
        reason: "Repeated fake orders",
        blockedBy: "admin-1",
        blockedAt: Timestamp.fromMillis(1000),
        customerUid,
      }),
    ]);
  });
};

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
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, "users/customer-1"), { role: "customer" }),
      setDoc(doc(database, "users/customer-2"), { role: "customer" }),
      setDoc(doc(database, "users/admin-1"), { role: "admin" }),
      setDoc(doc(database, `phoneRegistry/${normalizedPhone}`), {
        uid: "customer-1",
        phone: normalizedPhone,
        updatedAt: Timestamp.fromMillis(1000),
      }),
      setDoc(doc(database, `phoneRegistry/${otherPhone}`), {
        uid: "customer-2",
        phone: otherPhone,
        updatedAt: Timestamp.fromMillis(1000),
      }),
    ]);
  });
});

describe("phone registry rules", () => {
  it("allows blocked customers to create a pending restoration request", async () => {
    await seedBlockedCustomerPhone();
    const database = testEnv.authenticatedContext("customer-1").firestore();

    const requestId = await assertSucceeds(
      createPhoneRestorationRequest(
        database,
        "customer-1",
        `+63${normalizedPhone.slice(1)}`,
        "My account was blocked after a mistaken report.",
      ),
    );
    const requestSnapshot = await assertSucceeds(
      getDoc(doc(database, `phoneRestorationRequests/${requestId}`)),
    );
    const request = requestSnapshot.data();
    assert.equal(request.uid, "customer-1");
    assert.equal(request.phoneNumber, normalizedPhone);
    assert.equal(request.status, "pending");
    assert.equal(
      request.reason,
      "My account was blocked after a mistaken report.",
    );
    assert.ok(request.createdAt instanceof Timestamp);
    assert.ok(request.updatedAt instanceof Timestamp);
    await assertFails(
      getDocs(collection(database, "phoneRestorationRequests")),
    );
    assert.equal(
      (await getCustomerPhoneRestorationRequests(
        database,
        "customer-1",
        normalizedPhone,
      )).length,
      1,
    );
  });

  it("only lets the customer whose profile owns the blocked number request restoration", async () => {
    await seedBlockedCustomerPhone();
    const otherCustomerDatabase = testEnv.authenticatedContext(
      "customer-2",
    ).firestore();

    await assertFails(
      createPhoneRestorationRequest(
        otherCustomerDatabase,
        "customer-2",
        normalizedPhone,
        "Please restore this number.",
      ),
    );
  });

  it("prevents duplicate pending restoration requests in Firestore rules", async () => {
    await seedBlockedCustomerPhone();
    const database = testEnv.authenticatedContext("customer-1").firestore();
    const firstRequestId = await assertSucceeds(
      createPhoneRestorationRequest(
        database,
        "customer-1",
        normalizedPhone,
        "Please review this block.",
      ),
    );
    assert.ok(firstRequestId);
    await assert.rejects(
      createPhoneRestorationRequest(
        database,
        "customer-1",
        normalizedPhone,
        "A duplicate request.",
      ),
      { code: "phone-restoration/pending" },
    );

    const duplicateBatch = writeBatch(database);
    duplicateBatch.set(
      doc(database, "phoneRestorationRequests/duplicate"),
      {
        uid: "customer-1",
        phoneNumber: normalizedPhone,
        reason: "A duplicate request.",
        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    );
    duplicateBatch.set(
      doc(database, "phoneRestorationPending/customer-1"),
      {
        uid: "customer-1",
        phoneNumber: normalizedPhone,
        requestId: "duplicate",
        createdAt: serverTimestamp(),
      },
    );
    await assertFails(duplicateBatch.commit());
  });

  it("allows admins to approve and unblock, while customers cannot resolve requests", async () => {
    await seedBlockedCustomerPhone();
    const customerDatabase = testEnv.authenticatedContext(
      "customer-1",
    ).firestore();
    const adminDatabase = testEnv.authenticatedContext("admin-1").firestore();
    const requestId = await createPhoneRestorationRequest(
      customerDatabase,
      "customer-1",
      normalizedPhone,
      "I am the registered owner of this number.",
    );
    assert.equal(
      (await listPhoneRestorationRequests(adminDatabase)).length,
      1,
    );
    const requestRef = doc(
      customerDatabase,
      `phoneRestorationRequests/${requestId}`,
    );

    await assertFails(
      updateDoc(requestRef, { status: "approved" }),
    );
    await assertFails(deleteDoc(requestRef));
    await assertFails(
      resolvePhoneRestorationRequest(
        customerDatabase,
        requestId,
        "approved",
        "customer-1",
      ),
    );
    await assertSucceeds(
      resolvePhoneRestorationRequest(
        adminDatabase,
        requestId,
        "approved",
        "admin-1",
      ),
    );

    const resolvedRequest = (
      await getDoc(doc(adminDatabase, `phoneRestorationRequests/${requestId}`))
    ).data();
    assert.equal(resolvedRequest.status, "approved");
    assert.equal(resolvedRequest.reviewedBy, "admin-1");
    assert.ok(resolvedRequest.reviewedAt instanceof Timestamp);
    assert.equal(
      (await getDoc(doc(adminDatabase, `blockedPhones/${normalizedPhone}`)))
        .exists(),
      false,
    );
    assert.equal(
      (await getDoc(doc(adminDatabase, "phoneRestorationPending/customer-1")))
        .exists(),
      false,
    );
  });

  it("allows admins to reject a request without unblocking the phone", async () => {
    await seedBlockedCustomerPhone();
    const customerDatabase = testEnv.authenticatedContext(
      "customer-1",
    ).firestore();
    const adminDatabase = testEnv.authenticatedContext("admin-1").firestore();
    const requestId = await createPhoneRestorationRequest(
      customerDatabase,
      "customer-1",
      normalizedPhone,
      "Please review my account.",
    );

    await assertSucceeds(
      resolvePhoneRestorationRequest(
        adminDatabase,
        requestId,
        "rejected",
        "admin-1",
      ),
    );
    assert.equal(
      (
        await getDoc(
          doc(adminDatabase, `phoneRestorationRequests/${requestId}`),
        )
      ).data().status,
      "rejected",
    );
    assert.equal(
      (await getDoc(doc(adminDatabase, `blockedPhones/${normalizedPhone}`)))
        .exists(),
      true,
    );
  });

  it("allows owners and admins to read registry mappings but denies foreign reads and listing", async () => {
    const ownerDatabase = testEnv.authenticatedContext(
      "customer-1",
    ).firestore();
    const foreignDatabase = testEnv.authenticatedContext(
      "customer-2",
    ).firestore();
    const adminDatabase = testEnv.authenticatedContext("admin-1").firestore();

    await assertSucceeds(
      getDoc(doc(ownerDatabase, `phoneRegistry/${normalizedPhone}`)),
    );
    await assertFails(
      getDoc(doc(foreignDatabase, `phoneRegistry/${normalizedPhone}`)),
    );
    await assertSucceeds(
      getDoc(doc(adminDatabase, `phoneRegistry/${normalizedPhone}`)),
    );
    await assertFails(getDocs(collection(ownerDatabase, "phoneRegistry")));
  });

  it("prevents another account from claiming an already-owned number", async () => {
    const database = testEnv.authenticatedContext("customer-2").firestore();

    await assertFails(
      setDoc(doc(database, `phoneRegistry/${normalizedPhone}`), {
        uid: "customer-2",
        phone: normalizedPhone,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("claims an unregistered transaction number and fills an empty profile phone", async () => {
    const database = testEnv.authenticatedContext("customer-1").firestore();
    const newPhone = "09191234567";

    await assertSucceeds(claimPhoneForUser(database, "customer-1", newPhone));
    assert.equal(
      (await getDoc(doc(database, "users/customer-1"))).data().phone,
      newPhone,
    );
    const profile = (await getDoc(doc(database, "users/customer-1"))).data();
    assert.equal(profile.phoneNumber, newPhone);
    assert.ok(profile.phoneUpdatedAt instanceof Timestamp);
    assert.equal(
      (await getDoc(doc(database, `phoneRegistry/${newPhone}`))).data().uid,
      "customer-1",
    );
    assert.deepEqual(
      (await getDoc(doc(database, `phoneClaims/${newPhone}`))).data(),
      { phone: newPhone },
    );
  });

  it("saves first-time phone setup with an existing null phone field and address", async () => {
    const database = testEnv.authenticatedContext("customer-1").firestore();
    const newPhone = "09191234567";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users/customer-1"), {
        role: "customer",
        phone: null,
        phoneNumber: null,
        phoneUpdatedAt: null,
      });
    });

    await assertSucceeds(
      saveCustomerProfileWithPhone(
        database,
        "customer-1",
        newPhone,
        {
          name: "Updated Customer",
          deliveryAddress: {
            houseNumberStreet: "12 Main Street",
            barangay: "Riverside",
            streetPurok: "Purok 2",
            municipalityCity: "Isabela",
            province: "Negros Occidental",
            deliveryInstructions: "",
            deliveryLocation: null,
          },
        },
      ),
    );

    const profile = (await getDoc(doc(database, "users/customer-1"))).data();
    assert.equal(profile.phone, newPhone);
    assert.equal(profile.phoneNumber, newPhone);
    assert.ok(profile.phoneUpdatedAt instanceof Timestamp);
    assert.equal(profile.deliveryAddress.barangay, "Riverside");
    assert.equal(profile.deliveryAddress.deliveryLocation, null);
  });

  it("atomically changes a profile phone and releases its previous claim", async () => {
    const database = testEnv.authenticatedContext("customer-1").firestore();
    const newPhone = "09191234567";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users/customer-1"), {
        role: "customer",
        phone: normalizedPhone,
        phoneUpdatedAt: Timestamp.fromMillis(
          Date.now() - 31 * 24 * 60 * 60 * 1000,
        ),
      });
    });

    const deliveryAddress = {
      houseNumberStreet: "12 Main Street",
      barangay: "Riverside",
      streetPurok: "Purok 2",
      municipalityCity: "Isabela",
      province: "Negros Occidental",
      deliveryInstructions: "Call on arrival",
      deliveryLocation: { lat: 10.2054, lng: 122.9882 },
    };
    await assertSucceeds(
      saveCustomerProfileWithPhone(
        database,
        "customer-1",
        newPhone,
        {
          firstName: "Updated",
          lastName: "Customer",
          name: "Updated Customer",
          deliveryAddress,
        },
      ),
    );
    const profile = (await getDoc(doc(database, "users/customer-1"))).data();
    assert.equal(
      profile.phone,
      newPhone,
    );
    assert.equal(
      profile.phoneNumber,
      newPhone,
    );
    assert.deepEqual(profile.deliveryAddress, deliveryAddress);
    assert.equal(
      (await getDoc(doc(database, `phoneRegistry/${newPhone}`))).data().uid,
      "customer-1",
    );
    assert.equal(
      (
        await getDoc(doc(database, `phoneRegistry/${normalizedPhone}`))
      ).exists(),
      false,
    );
  });

  it("prevents a phone change before the 30-day cooldown expires", async () => {
    const database = testEnv.authenticatedContext("customer-1").firestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users/customer-1"), {
        role: "customer",
        phone: normalizedPhone,
        phoneUpdatedAt: Timestamp.fromMillis(Date.now()),
      });
    });

    await assertFails(
      saveCustomerProfileWithPhone(
        database,
        "customer-1",
        "09191234567",
        { name: "Updated Customer" },
      ),
    );
  });

  it("allows an administrator to reset the cooldown before a customer changes their phone", async () => {
    const adminDatabase = testEnv.authenticatedContext("admin-1").firestore();
    const customerDatabase = testEnv.authenticatedContext(
      "customer-1",
    ).firestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users/customer-1"), {
        role: "customer",
        phone: normalizedPhone,
        phoneNumber: normalizedPhone,
        phoneUpdatedAt: Timestamp.fromMillis(Date.now()),
      });
    });

    await assertFails(
      updateDoc(doc(customerDatabase, "users/customer-1"), {
        phoneUpdatedAt: Timestamp.fromMillis(
          Date.now() - 31 * 24 * 60 * 60 * 1000,
        ),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(adminDatabase, "users/customer-1"), {
        phoneUpdatedAt: Timestamp.fromMillis(
          Date.now() - 31 * 24 * 60 * 60 * 1000,
        ),
      }),
    );
    assert.ok(
      (await getDoc(doc(customerDatabase, "users/customer-1")))
        .data()
        .phoneUpdatedAt instanceof Timestamp,
    );
    await assertSucceeds(
      saveCustomerProfileWithPhone(
        customerDatabase,
        "customer-1",
        "09191234567",
        {},
      ),
    );
  });

  it("allows an administrator to reset legacy profiles without a phone timestamp", async () => {
    const adminDatabase = testEnv.authenticatedContext("admin-1").firestore();
    const customerDatabase = testEnv.authenticatedContext(
      "customer-1",
    ).firestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users/customer-1"), {
        role: "customer",
        phone: normalizedPhone,
        phoneNumber: normalizedPhone,
      });
    });

    await assertFails(
      saveCustomerProfileWithPhone(
        customerDatabase,
        "customer-1",
        "09191234567",
        {},
      ),
    );
    await assertSucceeds(
      updateDoc(doc(adminDatabase, "users/customer-1"), {
        phoneUpdatedAt: Timestamp.fromMillis(
          Date.now() - 31 * 24 * 60 * 60 * 1000,
        ),
      }),
    );
    await assertSucceeds(
      saveCustomerProfileWithPhone(
        customerDatabase,
        "customer-1",
        "09191234567",
        {},
      ),
    );
  });

  it("prevents saving a profile with a newly blocked phone", async () => {
    const database = testEnv.authenticatedContext("customer-1").firestore();
    const newPhone = "09191234567";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDatabase = context.firestore();
      await Promise.all([
        setDoc(doc(adminDatabase, "users/customer-1"), {
          role: "customer",
          phone: normalizedPhone,
          phoneUpdatedAt: Timestamp.fromMillis(
            Date.now() - 31 * 24 * 60 * 60 * 1000,
          ),
        }),
        setDoc(doc(adminDatabase, `blockedPhones/${newPhone}`), {
          phone: newPhone,
          reason: "Test",
          blockedBy: "admin-1",
          blockedAt: Timestamp.fromMillis(1000),
        }),
      ]);
    });

    await assert.rejects(
      saveCustomerProfileWithPhone(
        database,
        "customer-1",
        newPhone,
        { name: "Updated Customer" },
      ),
      { code: "phone/blocked" },
    );
  });

  it("allows administrators to change a profile phone before cooldown", async () => {
    const database = testEnv.authenticatedContext("admin-1").firestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users/customer-1"), {
        role: "customer",
        phone: normalizedPhone,
        phoneUpdatedAt: Timestamp.fromMillis(Date.now()),
      });
      await setDoc(doc(context.firestore(), `phoneRegistry/09191234567`), {
        uid: "customer-1",
        phone: "09191234567",
        updatedAt: Timestamp.fromMillis(Date.now()),
      });
    });

    const newPhone = "09191234567";
    await assertSucceeds(
      setDoc(doc(database, `users/customer-1`), {
        role: "customer",
        phone: newPhone,
        phoneNumber: newPhone,
        phoneUpdatedAt: serverTimestamp(),
      }),
    );
  });

  it("requires normalized phone ownership for order requests", async () => {
    const database = testEnv.authenticatedContext(
      "customer-1",
      { email: "customer@example.test" },
    ).firestore();

    await assertSucceeds(
      setDoc(
        doc(database, "orderRequests/valid-phone"),
        makeRequest(),
      ),
    );
    await assertFails(
      setDoc(
        doc(database, "orderRequests/international-phone"),
        makeRequest({ phone: "+639171234567" }),
      ),
    );
    await assertFails(
      setDoc(
        doc(database, "orderRequests/other-owner-phone"),
        makeRequest({ phone: otherPhone }),
      ),
    );
  });

  it("requires normalized phone ownership for reservations", async () => {
    const database = testEnv.authenticatedContext(
      "customer-1",
      { email: "customer@example.test" },
    ).firestore();

    await assertSucceeds(
      createReservationWithReference(
        database,
        "reservations/valid-phone",
        makeReservation(),
      ),
    );
    await assertFails(
      createReservationWithReference(
        database,
        "reservations/international-phone",
        makeReservation({
          phone: "+639171234567",
          paymentReference: "TESTREF002",
        }),
      ),
    );
  });

  it("lets administrators manage blocked phones but not customers", async () => {
    const adminDatabase = testEnv.authenticatedContext("admin-1").firestore();
    const customerDatabase = testEnv.authenticatedContext(
      "customer-1",
    ).firestore();
    const otherCustomerDatabase = testEnv.authenticatedContext(
      "customer-2",
    ).firestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users/customer-1"), {
        role: "customer",
        phone: "09191234567",
        phoneNumber: "09191234567",
      });
    });

    await assertSucceeds(
      blockPhone(
        adminDatabase,
        "0919 123 4567",
        "admin-1",
        "Abuse reports",
        "customer-1",
        {
          customerName: "Cafe Customer",
          address: "12 Main Street, Isabela",
        },
      ),
    );
    assert.equal(await isPhoneBlocked(adminDatabase, "09191234567"), true);
    const customerRead = await assertSucceeds(
      getDoc(doc(customerDatabase, "blockedPhones/09191234567")),
    );
    assert.equal(customerRead.exists(), true);
    await assertFails(
      getDoc(doc(otherCustomerDatabase, "blockedPhones/09191234567")),
    );
    assert.equal(
      await isPhoneBlocked(otherCustomerDatabase, "09191234567"),
      true,
    );
    await assertFails(listBlockedPhones(customerDatabase));
    const blockedPhone = (
      await getDoc(doc(adminDatabase, "blockedPhones/09191234567"))
    ).data();
    assert.equal(blockedPhone.phoneNumber, "09191234567");
    assert.equal(blockedPhone.reason, "Abuse reports");
    assert.equal(blockedPhone.blockedBy, "admin-1");
    assert.equal(blockedPhone.customerUid, "customer-1");
    assert.equal(blockedPhone.customerName, "Cafe Customer");
    assert.equal(blockedPhone.address, "12 Main Street, Isabela");
    assert.ok(blockedPhone.blockedAt instanceof Timestamp);
    assert.equal((await listBlockedPhones(adminDatabase)).length, 1);
    await assertFails(
      blockPhone(customerDatabase, otherPhone, "customer-1"),
    );
    await assertSucceeds(unblockPhone(adminDatabase, "09191234567"));
    assert.equal(await isPhoneBlocked(adminDatabase, "09191234567"), false);
  });

  it("denies new order requests and reservations for blocked phones", async () => {
    const database = testEnv.authenticatedContext(
      "customer-1",
      { email: "customer@example.test" },
    ).firestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), `blockedPhones/${normalizedPhone}`),
        {
          phone: normalizedPhone,
          reason: "Test",
          blockedBy: "admin-1",
          blockedAt: Timestamp.fromMillis(1000),
        },
      );
    });

    await assertFails(
      setDoc(doc(database, "orderRequests/blocked-phone"), makeRequest()),
    );
    await assertFails(
      createReservationWithReference(
        database,
        "reservations/blocked-phone",
        makeReservation(),
      ),
    );
  });
});
