import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import process from "node:process";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import {
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

import { createMenuWriteService } from "../src/services/menuWriteService.js";
import {
  runMenuMigration,
  startMenuMigration,
} from "../scripts/menu-migration.js";

const projectId = "demo-cactus-cafe-menu-migration";
const rules = readFileSync(
  process.env.FIRESTORE_RULES_PATH
    || new URL("../firestore.rules", import.meta.url),
  "utf8",
);

let testEnv;
let reportDirectory;

const legacyItem = (overrides = {}) => ({
  name: "SIOMAI",
  category: "Snacks",
  description: "Steamed pork siomai.",
  price: 80,
  imageUrl: "https://example.test/siomai.jpg",
  available: true,
  featured: false,
  popular: true,
  createdAt: Timestamp.fromMillis(1000),
  ...overrides,
});

const menuItem = (overrides = {}) => ({
  ...legacyItem(),
  menuRevision: 1,
  ...overrides,
});

const priceEntry = (overrides = {}) => ({
  priceCents: 8000,
  available: true,
  menuRevision: 1,
  ...overrides,
});

async function seedMigrationState(database) {
  const now = Timestamp.fromMillis(1000);
  await setDoc(doc(database, "menuControl/migration"), {
    state: "migrating",
    startedAt: now,
    updatedAt: now,
    updatedBy: "admin-1",
  });
}

async function seedOperatorAndOptionalMigration() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, "users/admin-1"), { role: "admin" }),
      setDoc(doc(database, "users/admin-2"), { role: "admin" }),
      setDoc(doc(database, "migrationOperators/admin-1"), { enabled: true }),
      setDoc(doc(database, "users/customer-1"), { role: "customer" }),
      seedMigrationState(database),
    ]);
  });
}

async function seedMenuAndPriceBook({
  items,
  prices,
  bookRevision = 1,
}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    const writes = Object.entries(items).map(([id, data]) =>
      setDoc(doc(database, `menuItems/${id}`), data),
    );
    if (prices !== undefined) {
      writes.push(setDoc(doc(database, "menuControl/current"), {
        revision: bookRevision,
        updatedAt: Timestamp.fromMillis(1000),
        lastChangedMenuItemId: Object.keys(prices)[0] || "seed",
        prices,
      }));
    }
    await Promise.all(writes);
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  reportDirectory = await mkdtemp(join(tmpdir(), "cactus-menu-migration-"));
  await seedOperatorAndOptionalMigration();
});

afterEach(async () => {
  if (reportDirectory) {
    await rm(reportDirectory, { recursive: true, force: true });
    reportDirectory = undefined;
  }
});

describe("current-rules menu migration utility", () => {
  it("defaults to a no-write dry run and writes a full inventory backup and audit", async () => {
    await seedMenuAndPriceBook({
      items: {
        SIOMAI: legacyItem(),
        TEA: legacyItem({ name: "Tea", price: 45 }),
      },
    });
    const database = testEnv.authenticatedContext("admin-1").firestore();

    const result = await runMenuMigration({
      database,
      operatorUid: "admin-1",
      reportDirectory,
    });

    assert.equal(result.audit.mode, "dry-run");
    assert.equal(result.audit.menuItemCount, 2);
    assert.equal(result.audit.clean, false);
    assert.equal(result.audit.pendingWrites.length, 2);
    assert.equal(result.audit.pendingWrites[0].bootstrapPriceBook, true);

    const backup = JSON.parse(await readFile(result.backupPath, "utf8"));
    const audit = JSON.parse(await readFile(result.auditPath, "utf8"));
    assert.deepEqual(Object.keys(backup.menuItems).sort(), ["SIOMAI", "TEA"]);
    assert.equal(backup.menuItems.SIOMAI.price, 80);
    assert.equal(backup.menuItems.SIOMAI.menuRevision, undefined);
    assert.equal(audit.items.length, 2);
    assert.equal(audit.items.find((item) => item.id === "SIOMAI").priceCents, 8000);

    const unchanged = await getDoc(doc(database, "menuItems/SIOMAI"));
    assert.equal(unchanged.data().menuRevision, undefined);
    assert.equal(
      (await getDoc(doc(database, "menuControl/current"))).exists(),
      false,
    );
  });

  it("backfills legacy items one at a time and bootstraps the missing book", async () => {
    await seedMenuAndPriceBook({
      items: {
        SIOMAI: legacyItem(),
        TEA: legacyItem({ name: "Tea", price: 45 }),
      },
    });
    const database = testEnv.authenticatedContext("admin-1").firestore();

    const result = await runMenuMigration({
      database,
      operatorUid: "admin-1",
      mode: "apply",
      reportDirectory,
    });

    assert.equal(result.audit.clean, true);
    assert.deepEqual(result.audit.appliedItemIds, ["SIOMAI", "TEA"]);
    const siomai = await getDoc(doc(database, "menuItems/SIOMAI"));
    const tea = await getDoc(doc(database, "menuItems/TEA"));
    const book = await getDoc(doc(database, "menuControl/current"));
    assert.equal(siomai.data().menuRevision, 1);
    assert.equal(siomai.data().description, "Steamed pork siomai.");
    assert.equal(siomai.data().createdAt.toMillis(), 1000);
    assert.equal(tea.data().menuRevision, 1);
    assert.equal(book.data().revision, 2);
    assert.equal(book.data().prices.SIOMAI.priceCents, 8000);
    assert.deepEqual(book.data().prices.SIOMAI, priceEntry());
    assert.deepEqual(book.data().prices.TEA, priceEntry({
      priceCents: 4500,
    }));
    assert.ok(book.data().updatedAt instanceof Timestamp);
  });

  it("backfills into an existing book and preserves unrelated matching entries", async () => {
    await seedMenuAndPriceBook({
      items: {
        SIOMAI: legacyItem(),
        TEA: menuItem({ name: "Tea", price: 45 }),
      },
      prices: { TEA: priceEntry({ priceCents: 4500 }) },
    });
    const database = testEnv.authenticatedContext("admin-1").firestore();

    const result = await runMenuMigration({
      database,
      operatorUid: "admin-1",
      mode: "apply",
      reportDirectory,
    });

    assert.equal(result.audit.clean, true);
    const book = await getDoc(doc(database, "menuControl/current"));
    assert.equal(book.data().revision, 2);
    assert.deepEqual(book.data().prices.TEA, priceEntry({
      priceCents: 4500,
    }));
    assert.deepEqual(book.data().prices.SIOMAI, priceEntry());
  });

  it("blocks finalization until apply and a complete audit both pass", async () => {
    await seedMenuAndPriceBook({
      items: { SIOMAI: legacyItem() },
    });
    const database = testEnv.authenticatedContext("admin-1").firestore();

    await assert.rejects(
      runMenuMigration({
        database,
        operatorUid: "admin-1",
        mode: "finalize",
        reportDirectory,
      }),
      /pending item write/,
    );
    assert.equal(
      (await getDoc(doc(database, "menuControl/migration"))).data().state,
      "migrating",
    );

    await runMenuMigration({
      database,
      operatorUid: "admin-1",
      mode: "apply",
      reportDirectory,
    });
    const result = await runMenuMigration({
      database,
      operatorUid: "admin-1",
      mode: "finalize",
      reportDirectory,
    });

    assert.equal(result.audit.clean, true);
    assert.equal(result.audit.migrationState, "ready");
    assert.equal(
      (await getDoc(doc(database, "menuControl/migration"))).data().state,
      "ready",
    );
    const report = JSON.parse(await readFile(result.auditPath, "utf8"));
    assert.equal(report.clean, true);
    assert.equal(report.migrationState, "ready");
  });

  it("refuses an operator without an enabled grant", async () => {
    const database = testEnv.authenticatedContext("customer-1").firestore();

    await assert.rejects(
      runMenuMigration({
        database,
        operatorUid: "customer-1",
        reportDirectory,
      }),
      /not an administrator/,
    );

    await assert.rejects(
      runMenuMigration({
        database: testEnv.authenticatedContext("admin-2").firestore(),
        operatorUid: "admin-2",
        reportDirectory,
      }),
      /no enabled migration operator grant/,
    );
  });

  it("requires the migration runner's expected project to match Firestore", async () => {
    await assert.rejects(
      runMenuMigration({
        database: testEnv.authenticatedContext("admin-1").firestore(),
        operatorUid: "admin-1",
        expectedProjectId: "unexpected-project",
        reportDirectory,
      }),
      /outside expected project "unexpected-project"/,
    );
  });

  it("denies non-operator administrators paired menu writes while migrating", async () => {
    await seedMenuAndPriceBook({
      items: { SIOMAI: menuItem() },
      prices: { SIOMAI: priceEntry() },
    });
    const database = testEnv.authenticatedContext("admin-2").firestore();
    const service = createMenuWriteService(database);

    await assert.rejects(
      service.setMenuItemAvailability("SIOMAI", false, {
        expectedMenuRevision: 1,
      }),
      (error) => error.code === "permission-denied",
    );
    await assert.rejects(
      service.deleteMenuItem("SIOMAI", { expectedMenuRevision: 1 }),
      (error) => error.code === "permission-denied",
    );
    await assert.rejects(
      service.createMenuItem({
        name: "Tea",
        price: 45,
        available: true,
      }),
      (error) => error.code === "permission-denied",
    );

    const item = await getDoc(doc(database, "menuItems/SIOMAI"));
    const book = await getDoc(doc(database, "menuControl/current"));
    assert.equal(item.data().available, true);
    assert.equal(item.data().menuRevision, 1);
    assert.equal(book.data().revision, 1);
    assert.deepEqual(book.data().prices.SIOMAI, priceEntry());
  });

  it("denies paired menu writes when an administrator grant is disabled", async () => {
    await seedMenuAndPriceBook({
      items: { SIOMAI: menuItem() },
      prices: { SIOMAI: priceEntry() },
    });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "migrationOperators/admin-2"),
        { enabled: false },
      );
    });
    const database = testEnv.authenticatedContext("admin-2").firestore();
    const service = createMenuWriteService(database);

    await assert.rejects(
      service.setMenuItemAvailability("SIOMAI", false, {
        expectedMenuRevision: 1,
      }),
      (error) => error.code === "permission-denied",
    );

    const item = await getDoc(doc(database, "menuItems/SIOMAI"));
    const book = await getDoc(doc(database, "menuControl/current"));
    assert.equal(item.data().available, true);
    assert.equal(item.data().menuRevision, 1);
    assert.equal(book.data().revision, 1);
    assert.deepEqual(book.data().prices.SIOMAI, priceEntry());
  });

  it("denies paired menu writes when the migration control document is missing", async () => {
    await seedMenuAndPriceBook({
      items: { SIOMAI: menuItem() },
      prices: { SIOMAI: priceEntry() },
    });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("menuControl/migration").delete();
    });
    const database = testEnv.authenticatedContext("admin-1").firestore();
    const service = createMenuWriteService(database);

    await assert.rejects(
      service.setMenuItemAvailability("SIOMAI", false, {
        expectedMenuRevision: 1,
      }),
      (error) => error.code === "permission-denied",
    );

    const migration = await getDoc(doc(database, "menuControl/migration"));
    const item = await getDoc(doc(database, "menuItems/SIOMAI"));
    const book = await getDoc(doc(database, "menuControl/current"));
    assert.equal(migration.exists(), false);
    assert.equal(item.data().available, true);
    assert.equal(item.data().menuRevision, 1);
    assert.equal(book.data().revision, 1);
    assert.deepEqual(book.data().prices.SIOMAI, priceEntry());
  });

  it("denies non-operators from creating or updating migration state", async () => {
    const database = testEnv.authenticatedContext("admin-2").firestore();
    const migrationRef = doc(database, "menuControl/migration");

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("menuControl/migration").delete();
    });
    await assert.rejects(
      setDoc(migrationRef, {
        state: "migrating",
        startedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: "admin-2",
      }),
      (error) => error.code === "permission-denied",
    );
    assert.equal((await getDoc(migrationRef)).exists(), false);

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await seedMigrationState(context.firestore());
    });
    await assert.rejects(
      updateDoc(migrationRef, {
        state: "finalizing",
        updatedAt: serverTimestamp(),
        updatedBy: "admin-2",
      }),
      (error) => error.code === "permission-denied",
    );

    const migration = (await getDoc(migrationRef)).data();
    assert.equal(migration.state, "migrating");
    assert.equal(migration.updatedBy, "admin-1");
  });

  it("denies migration operators from skipping or reversing state transitions", async () => {
    const database = testEnv.authenticatedContext("admin-1").firestore();
    const migrationRef = doc(database, "menuControl/migration");

    await assert.rejects(
      updateDoc(migrationRef, {
        state: "ready",
        updatedAt: serverTimestamp(),
        updatedBy: "admin-1",
      }),
      (error) => error.code === "permission-denied",
    );
    assert.equal((await getDoc(migrationRef)).data().state, "migrating");

    await updateDoc(migrationRef, {
      state: "finalizing",
      updatedAt: serverTimestamp(),
      updatedBy: "admin-1",
    });
    await assert.rejects(
      updateDoc(migrationRef, {
        state: "migrating",
        updatedAt: serverTimestamp(),
        updatedBy: "admin-1",
      }),
      (error) => error.code === "permission-denied",
    );
    assert.equal((await getDoc(migrationRef)).data().state, "finalizing");
  });

  it("allows the migration operator to perform a paired menu write while migrating", async () => {
    await seedMenuAndPriceBook({
      items: { SIOMAI: menuItem() },
      prices: { SIOMAI: priceEntry() },
    });
    const database = testEnv.authenticatedContext("admin-1").firestore();
    const service = createMenuWriteService(database);

    await service.setMenuItemAvailability("SIOMAI", false, {
      expectedMenuRevision: 1,
    });

    const item = await getDoc(doc(database, "menuItems/SIOMAI"));
    const book = await getDoc(doc(database, "menuControl/current"));
    assert.equal(item.data().available, false);
    assert.equal(item.data().menuRevision, 2);
    assert.equal(book.data().revision, 2);
    assert.deepEqual(book.data().prices.SIOMAI, priceEntry({
      available: false,
      menuRevision: 2,
    }));
  });

  it("denies paired menu and price-book writes while finalizing", async () => {
    await seedMenuAndPriceBook({
      items: { SIOMAI: menuItem() },
      prices: { SIOMAI: priceEntry() },
    });
    const database = testEnv.authenticatedContext("admin-1").firestore();
    await updateDoc(doc(database, "menuControl/migration"), {
      state: "finalizing",
      updatedAt: serverTimestamp(),
      updatedBy: "admin-1",
    });
    const service = createMenuWriteService(database);

    await assert.rejects(
      service.setMenuItemAvailability("SIOMAI", false, {
        expectedMenuRevision: 1,
      }),
      (error) => error.code === "permission-denied",
    );
    await assert.rejects(
      updateDoc(doc(database, "menuControl/current"), {
        revision: 2,
        updatedAt: serverTimestamp(),
        lastChangedMenuItemId: "SIOMAI",
        prices: {
          SIOMAI: priceEntry({
            available: false,
            menuRevision: 2,
          }),
        },
      }),
      (error) => error.code === "permission-denied",
    );
    await assert.rejects(
      service.createMenuItem({
        name: "Tea",
        category: "Drinks",
        description: "Freshly brewed tea.",
        price: 45,
        available: true,
      }),
      (error) => error.code === "permission-denied",
    );
    await assert.rejects(
      service.deleteMenuItem("SIOMAI", { expectedMenuRevision: 1 }),
      (error) => error.code === "permission-denied",
    );

    const menuItems = await getDocs(collection(database, "menuItems"));
    const item = await getDoc(doc(database, "menuItems/SIOMAI"));
    const book = await getDoc(doc(database, "menuControl/current"));
    assert.deepEqual(menuItems.docs.map((menuDoc) => menuDoc.id), ["SIOMAI"]);
    assert.equal(item.data().available, true);
    assert.equal(item.data().menuRevision, 1);
    assert.equal(book.data().revision, 1);
    assert.deepEqual(book.data().prices.SIOMAI, priceEntry());
  });

  it("denies clients from creating or changing migration operator grants", async () => {
    const database = testEnv.authenticatedContext("admin-1").firestore();

    await assert.rejects(
      setDoc(doc(database, "migrationOperators/admin-2"), { enabled: true }),
      (error) => error.code === "permission-denied",
    );
    await assert.rejects(
      updateDoc(doc(database, "migrationOperators/admin-1"), { enabled: false }),
      (error) => error.code === "permission-denied",
    );

    const grant = await getDoc(doc(database, "migrationOperators/admin-1"));
    assert.equal(grant.data().enabled, true);
  });

  it("audits invalid items and orphan price entries without modifying data", async () => {
    await seedMenuAndPriceBook({
      items: { SIOMAI: legacyItem({ available: "yes" }) },
      prices: {
        SIOMAI: priceEntry(),
        MISSING: priceEntry(),
      },
    });
    const database = testEnv.authenticatedContext("admin-1").firestore();

    const result = await runMenuMigration({
      database,
      operatorUid: "admin-1",
      reportDirectory,
    });

    assert.equal(result.audit.issues.length, 2);
    assert.equal(
      result.audit.issues.some((issue) => issue.code === "invalid-menu-item"),
      true,
    );
    assert.equal(
      result.audit.issues.some((issue) => issue.code === "orphan-price-entry"),
      true,
    );
    assert.equal(
      (await getDoc(doc(database, "menuItems/SIOMAI"))).data().menuRevision,
      undefined,
    );
  });

  it("allows an authorized operator to explicitly start migration", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("menuControl/migration").delete();
    });
    const database = testEnv.authenticatedContext("admin-1").firestore();

    await startMenuMigration({ database, operatorUid: "admin-1" });

    const migration = (
      await getDoc(doc(database, "menuControl/migration"))
    ).data();
    assert.equal(migration.state, "migrating");
    assert.equal(migration.updatedBy, "admin-1");
    assert.ok(migration.startedAt instanceof Timestamp);
    assert.ok(migration.updatedAt instanceof Timestamp);
  });
});
