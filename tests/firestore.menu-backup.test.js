import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import process from "node:process";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  Bytes,
  doc,
  GeoPoint,
  getDoc,
  setDoc,
  Timestamp,
} from "firebase/firestore";

import {
  captureMenuBackup,
  createMenuBackup,
  inspectMenuBackup,
  serializeFirestoreValue,
} from "../scripts/firestore-menu-backup.js";

const projectId = "demo-cactus-cafe-menu-backup";
const rules = readFileSync(
  new URL("../firestore.rules", import.meta.url),
  "utf8",
);

let testEnv;
let outputDirectory;

const menuItem = (overrides = {}) => ({
  name: "SIOMAI",
  category: "Snacks",
  description: "Legacy steamed pork siomai.",
  price: 80,
  available: true,
  menuRevision: 1,
  createdAt: new Timestamp(123456789, 987654321),
  ...overrides,
});

const priceEntry = (overrides = {}) => ({
  priceCents: 8000,
  available: true,
  menuRevision: 1,
  ...overrides,
});

const priceBook = (prices = { siomai: priceEntry() }) => ({
  revision: 1,
  updatedAt: new Timestamp(123456790, 123456789),
  lastChangedMenuItemId: "siomai",
  prices,
});

const migration = (overrides = {}) => ({
  state: "ready",
  startedAt: new Timestamp(123456700, 111222333),
  updatedAt: new Timestamp(123456790, 444555666),
  updatedBy: "admin-1",
  ...overrides,
});

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
  outputDirectory = await mkdtemp(join(tmpdir(), "cactus-menu-backup-test-"));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, "users/admin-1"), { role: "admin" }),
      setDoc(doc(database, "menuItems/siomai"), menuItem()),
      setDoc(doc(database, "menuItems/tea"), menuItem({
        name: "Tea",
        price: 45.5,
        available: false,
        menuRevision: 3,
      })),
      setDoc(doc(database, "menuControl/current"), priceBook({
        siomai: priceEntry(),
        tea: priceEntry({
          priceCents: 4550,
          available: false,
          menuRevision: 3,
        }),
      })),
      setDoc(doc(database, "menuControl/migration"), migration()),
    ]);
  });
});

afterEach(async () => {
  if (outputDirectory) {
    await rm(outputDirectory, { recursive: true, force: true });
    outputDirectory = undefined;
  }
});

describe("read-only Firestore menu backup", () => {
  it("captures all documents, fields, IDs, exact timestamps, inventory and hash", async () => {
    const database = testEnv.authenticatedContext("admin-1").firestore();
    const result = await captureMenuBackup({
      database,
      outputDirectory,
      generatedAt: "2026-11-14T02:00:00.000Z",
    });

    assert.equal(result.backup.projectId, projectId);
    assert.equal(result.backup.documentCount, 2);
    assert.deepEqual(result.backup.documentIds, ["siomai", "tea"]);
    assert.equal(result.backup.completenessReport.complete, true);
    assert.deepEqual(result.backup.completenessReport.issues, []);
    assert.deepEqual(result.backup.menuItems.map(({ id }) => id), ["siomai", "tea"]);
    const siomai = result.backup.menuItems.find(({ id }) => id === "siomai");
    assert.equal(siomai.fields.price, 80);
    assert.equal(siomai.fields.createdAt.__firestoreBackupType, "timestamp");
    assert.equal(siomai.fields.createdAt.seconds, 123456789);
    const sourceItem = await getDoc(doc(database, "menuItems/siomai"));
    const sourceBook = await getDoc(doc(database, "menuControl/current"));
    const sourceMigration = await getDoc(doc(database, "menuControl/migration"));
    assert.equal(siomai.fields.createdAt.nanoseconds, sourceItem.data().createdAt.nanoseconds);
    assert.equal(
      result.backup.menuControl.current.updatedAt.nanoseconds,
      sourceBook.data().updatedAt.nanoseconds,
    );
    assert.equal(
      result.backup.menuControl.migration.startedAt.nanoseconds,
      sourceMigration.data().startedAt.nanoseconds,
    );

    const { sha256, ...payload } = result.backup;
    const canonicalize = (value) => {
      if (Array.isArray(value)) return value.map(canonicalize);
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
        );
      }
      return value;
    };
    const expectedHash = createHash("sha256")
      .update(JSON.stringify(canonicalize(payload)), "utf8")
      .digest("hex");
    assert.equal(sha256, expectedHash);

    const onDisk = JSON.parse(await readFile(result.filePath, "utf8"));
    assert.equal(onDisk.sha256, result.backup.sha256);
    assert.equal(onDisk.menuItems[0].fields.price, 80);

    assert.equal(sourceItem.data().menuRevision, 1);
    assert.equal(sourceItem.data().price, 80);
  });

  it("reports missing, mismatched and orphaned price-book entries", () => {
    const report = inspectMenuBackup({
      menuDocuments: [
        { id: "siomai", data: menuItem() },
        { id: "tea", data: menuItem({ price: 45, menuRevision: 2 }) },
      ],
      priceBook: priceBook({
        siomai: priceEntry({ priceCents: 7900 }),
        orphan: priceEntry(),
      }),
      migration: migration(),
    });

    assert.equal(report.complete, true);
    assert.equal(report.catalogConsistent, false);
    assert.deepEqual(report.documentIds, ["siomai", "tea"]);
    assert.ok(report.issues.some((issue) =>
      issue.id === "siomai" && issue.message.includes("cents"),
    ));
    assert.ok(report.issues.some((issue) =>
      issue.id === "tea" && issue.message.includes("missing"),
    ));
    assert.ok(report.issues.some((issue) =>
      issue.id === "orphan" && issue.code === "orphan-price-entry",
    ));
  });

  it("reports a missing price book while capturing a missing migration state explicitly", () => {
    const report = inspectMenuBackup({
      menuDocuments: [{ id: "siomai", data: menuItem() }],
      priceBook: null,
      migration: null,
    });

    assert.equal(report.menuItemCount, 1);
    assert.equal(report.complete, true);
    assert.equal(report.migrationStateExists, false);
    assert.ok(report.issues.some((issue) => issue.code === "missing-price-book"));
    assert.ok(report.issues.some((issue) =>
      issue.code === "missing-migration-state",
    ));
  });

  it("reports a missing migration state separately from catalog consistency", () => {
    const report = inspectMenuBackup({
      menuDocuments: [{ id: "siomai", data: menuItem() }],
      priceBook: priceBook(),
      migration: null,
    });

    assert.equal(report.complete, true);
    assert.equal(report.catalogConsistent, true);
    assert.ok(report.issues.some((issue) =>
      issue.code === "missing-migration-state",
    ));
  });

  it("reports a non-ready migration state separately from catalog consistency", () => {
    const report = inspectMenuBackup({
      menuDocuments: [{ id: "siomai", data: menuItem() }],
      priceBook: priceBook(),
      migration: migration({ state: "migrating" }),
    });

    assert.equal(report.complete, true);
    assert.equal(report.catalogConsistent, true);
    assert.ok(report.issues.some((issue) =>
      issue.code === "migration-not-ready",
    ));
  });

  it("preserves Firestore timestamp seconds and nanoseconds exactly in the backup encoding", () => {
    const exactTimestamp = new Timestamp(123456789, 987654321);
    const backup = createMenuBackup({
      menuDocuments: [{
        id: "siomai",
        data: menuItem({ createdAt: exactTimestamp }),
      }],
      priceBook: priceBook(),
      migration: migration(),
      generatedAt: "2026-11-14T02:00:00.000Z",
      projectId,
    });

    assert.deepEqual(
      backup.menuItems[0].fields.createdAt,
      {
        __firestoreBackupType: "timestamp",
        seconds: 123456789,
        nanoseconds: 987654321,
      },
    );
  });

  it("serializes nested Firestore special values and escapes marker collisions", () => {
    const result = serializeFirestoreValue({
      timestamp: new Timestamp(3, 456789123),
      point: new GeoPoint(14.5995, 120.9842),
      bytes: Bytes.fromBase64String("AQID"),
      collision: {
        __firestoreBackupType: "a user field",
        nested: new Timestamp(8, 7654321),
      },
      reference: doc(
        testEnv.authenticatedContext("admin-1").firestore(),
        "linked/document",
      ),
    });

    assert.deepEqual(result.timestamp, {
      __firestoreBackupType: "timestamp",
      seconds: 3,
      nanoseconds: 456789123,
    });
    assert.deepEqual(result.point, {
      __firestoreBackupType: "geopoint",
      latitude: 14.5995,
      longitude: 120.9842,
    });
    assert.deepEqual(result.bytes, {
      __firestoreBackupType: "bytes",
      base64: "AQID",
    });
    assert.equal(result.collision.__firestoreBackupType, "map");
    assert.equal(
      result.collision.entries.__firestoreBackupType,
      "a user field",
    );
    assert.equal(
      result.collision.entries.nested.nanoseconds,
      7654321,
    );
    assert.deepEqual(result.reference, {
      __firestoreBackupType: "reference",
      projectId,
      path: "linked/document",
    });
  });

  it("requires admin permission to read the migration control document", async () => {
    const database = testEnv.authenticatedContext("customer-1").firestore();
    await assert.rejects(
      captureMenuBackup({ database, outputDirectory }),
      (error) => error.code === "permission-denied",
    );
  });

  it("does not allow writing a backup inside the project web root", async () => {
    const database = testEnv.authenticatedContext("admin-1").firestore();
    await assert.rejects(
      captureMenuBackup({
        database,
        outputDirectory: join(process.cwd(), "public", "backup"),
      }),
      /outside the project\/public web root/i,
    );
  });
});
