import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import {
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { connectAuthEmulator } from "firebase/auth";
import { deleteApp, initializeApp } from "firebase/app";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

const DEMO_PROJECT_ID = "demo-cactus-cafe-menu-migration";
const AUTH_EMULATOR_URL = "http://127.0.0.1:9099";
const FIRESTORE_EMULATOR_HOST = "127.0.0.1";
const FIRESTORE_EMULATOR_PORT = 8080;
const DEFAULT_REPORT_DIRECTORY = "menu-migration-reports";
const MIGRATION_PATH = "menuControl/migration";
const PRICE_BOOK_PATH = "menuControl/current";
const MENU_COLLECTION = "menuItems";

const PRICE_BOOK_KEYS = [
  "revision",
  "updatedAt",
  "lastChangedMenuItemId",
  "prices",
];

export class MenuMigrationError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "MenuMigrationError";
  }
}

function isObjectRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function serializeValue(value) {
  if (value instanceof Timestamp) {
    return {
      __firestoreType: "timestamp",
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
    };
  }
  if (Array.isArray(value)) return value.map(serializeValue);
  if (isObjectRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, serializeValue(child)]),
    );
  }
  return value;
}

function priceCentsFor(item) {
  return Math.round(item.price * 100);
}

function expectedPriceEntry(item, menuRevision) {
  return {
    priceCents: priceCentsFor(item),
    available: item.available,
    menuRevision,
  };
}

function priceEntryIsValid(entry) {
  return isObjectRecord(entry)
    && Object.keys(entry).length === 3
    && Object.hasOwn(entry, "priceCents")
    && Number.isInteger(entry.priceCents)
    && entry.priceCents >= 0
    && entry.priceCents <= 100000000
    && typeof entry.available === "boolean"
    && Number.isInteger(entry.menuRevision)
    && entry.menuRevision >= 1;
}

function menuFieldsAreValid(item) {
  return typeof item.price === "number"
    && Number.isFinite(item.price)
    && item.price >= 0
    && item.price <= 1000000
    && Number.isInteger(priceCentsFor(item))
    && priceCentsFor(item) >= 0
    && priceCentsFor(item) <= 100000000
    && typeof item.available === "boolean";
}

function priceBookIsValid(data) {
  return isObjectRecord(data)
    && Object.keys(data).length === PRICE_BOOK_KEYS.length
    && PRICE_BOOK_KEYS.every((key) => Object.hasOwn(data, key))
    && Number.isInteger(data.revision)
    && data.revision >= 1
    && data.updatedAt instanceof Timestamp
    && typeof data.lastChangedMenuItemId === "string"
    && data.lastChangedMenuItemId.length > 0
    && isObjectRecord(data.prices);
}

function samePriceEntry(left, right) {
  return priceEntryIsValid(left)
    && left.priceCents === right.priceCents
    && left.available === right.available
    && left.menuRevision === right.menuRevision;
}

function inspectCatalog(items, priceBook) {
  const issues = [];
  const plans = [];
  const itemIds = new Set(items.map(({ id }) => id));
  const prices = priceBook?.prices ?? {};
  const orderedItems = priceBook
    ? items
    : [...items].sort((left, right) => {
      const leftLegacy = !Object.hasOwn(left.data, "menuRevision");
      const rightLegacy = !Object.hasOwn(right.data, "menuRevision");
      return Number(rightLegacy) - Number(leftLegacy)
        || left.id.localeCompare(right.id);
    });

  if (priceBook && !priceBookIsValid(priceBook)) {
    issues.push({
      code: "invalid-price-book",
      message: "menuControl/current does not match the required schema.",
    });
    return { issues, plans, items: [] };
  }
  if (!priceBook && items.length === 0) {
    issues.push({
      code: "missing-empty-price-book",
      message:
        "The current rules cannot bootstrap an empty price book without a paired legacy menu item.",
    });
  }

  for (const { id, data } of orderedItems) {
    const itemIssues = [];
    if (!menuFieldsAreValid(data)) {
      itemIssues.push("Menu price or available field is missing or invalid.");
    }

    const hasRevision = Object.hasOwn(data, "menuRevision");
    if (
      hasRevision
      && (!Number.isInteger(data.menuRevision) || data.menuRevision < 1)
    ) {
      itemIssues.push("menuRevision must be a positive integer.");
    }

    const currentEntry = prices[id];
    if (currentEntry !== undefined && !priceEntryIsValid(currentEntry)) {
      itemIssues.push("The existing price-book entry is invalid.");
    }

    if (itemIssues.length > 0) {
      issues.push({ id, code: "invalid-menu-item", messages: itemIssues });
      continue;
    }

    if (hasRevision && samePriceEntry(
      currentEntry,
      expectedPriceEntry(data, data.menuRevision),
    )) {
      continue;
    }

    const menuRevision = hasRevision ? data.menuRevision + 1 : 1;
    const priceEntry = expectedPriceEntry(data, menuRevision);

    if (!hasRevision && samePriceEntry(currentEntry, priceEntry)) {
      issues.push({
        id,
        code: "legacy-entry-already-matches",
        message:
          "The legacy item already has an identical price entry. Current rules require exactly one price entry to change in the paired batch, so it cannot be backfilled safely without a separately reviewed resolution.",
      });
      continue;
    }

    if (!priceBook && hasRevision) {
      issues.push({
        id,
        code: "cannot-bootstrap-from-revisioned-item",
        message:
          "The current rules only allow creating the first price book paired with a legacy item that receives menuRevision 1.",
      });
      continue;
    }

    plans.push({
      id,
      currentMenuRevision: hasRevision ? data.menuRevision : null,
      menuRevision,
      priceEntry,
      bootstrapPriceBook: !priceBook && plans.length === 0,
    });
  }

  for (const id of Object.keys(prices)) {
    if (!itemIds.has(id)) {
      issues.push({
        id,
        code: "orphan-price-entry",
        message: "Price-book entry has no corresponding menu document.",
      });
    }
  }

  return { issues, plans, items };
}

async function loadCatalog(database) {
  const [menuSnapshot, priceBookSnapshot, migrationSnapshot] = await Promise.all([
    getDocs(collection(database, MENU_COLLECTION)),
    getDoc(doc(database, PRICE_BOOK_PATH)),
    getDoc(doc(database, MIGRATION_PATH)),
  ]);
  return {
    items: menuSnapshot.docs
      .map((document) => ({ id: document.id, data: document.data() }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    priceBook: priceBookSnapshot.exists() ? priceBookSnapshot.data() : null,
    migration: migrationSnapshot.exists() ? migrationSnapshot.data() : null,
  };
}

async function requireMigrationOperator(database, uid) {
  if (typeof uid !== "string" || !uid.trim()) {
    throw new MenuMigrationError("An authenticated migration operator is required.");
  }

  const [profileSnapshot, grantSnapshot] = await Promise.all([
    getDoc(doc(database, "users", uid)),
    getDoc(doc(database, "migrationOperators", uid)),
  ]);
  if (!profileSnapshot.exists() || profileSnapshot.data().role !== "admin") {
    throw new MenuMigrationError("The authenticated account is not an administrator.");
  }
  if (!grantSnapshot.exists() || grantSnapshot.data().enabled !== true) {
    throw new MenuMigrationError("The account has no enabled migration operator grant.");
  }
}

async function writeJsonReport(reportDirectory, runId, suffix, data) {
  await mkdir(reportDirectory, { recursive: true });
  const path = resolve(reportDirectory, `${runId}-${suffix}.json`);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return path;
}

function makeAuditReport({
  runId,
  mode,
  projectId,
  items,
  priceBook,
  migration,
}) {
  const result = inspectCatalog(items, priceBook);
  return {
    runId,
    generatedAt: new Date().toISOString(),
    mode,
    project: projectId,
    migrationState: migration?.state ?? null,
    menuItemCount: items.length,
    priceBookRevision: priceBook?.revision ?? null,
    clean: result.issues.length === 0 && result.plans.length === 0,
    pendingWrites: result.plans,
    issues: result.issues,
    items: items.map(({ id, data }) => ({
      id,
      price: data.price ?? null,
      priceCents: menuFieldsAreValid(data) ? priceCentsFor(data) : null,
      available: data.available ?? null,
      menuRevision: data.menuRevision ?? null,
      priceEntry: serializeValue(priceBook?.prices?.[id] ?? null),
    })),
  };
}

function requireProject(database, expectedProjectId) {
  if (
    typeof expectedProjectId !== "string"
    || database?.app?.options?.projectId !== expectedProjectId
  ) {
    throw new MenuMigrationError(
      `Refusing to run outside expected project "${expectedProjectId}".`,
    );
  }
}

async function applyOneItem(database, plan) {
  const menuRef = doc(database, MENU_COLLECTION, plan.id);
  const bookRef = doc(database, PRICE_BOOK_PATH);
  const [menuSnapshot, bookSnapshot] = await Promise.all([
    getDoc(menuRef),
    getDoc(bookRef),
  ]);
  if (!menuSnapshot.exists()) {
    throw new MenuMigrationError(`Menu item "${plan.id}" disappeared; inventory again.`);
  }

  const menuData = menuSnapshot.data();
  const actualRevision = menuData.menuRevision ?? null;
  if (actualRevision !== plan.currentMenuRevision) {
    throw new MenuMigrationError(
      `Menu item "${plan.id}" changed after inventory; no write was attempted.`,
    );
  }

  const priceBook = bookSnapshot.exists() ? bookSnapshot.data() : null;
  if (priceBook && !priceBookIsValid(priceBook)) {
    throw new MenuMigrationError("The price book changed to an invalid structure.");
  }

  const actualPriceEntry = priceBook?.prices?.[plan.id];
  if (actualPriceEntry !== undefined && !priceEntryIsValid(actualPriceEntry)) {
    throw new MenuMigrationError(`Price-book entry "${plan.id}" is invalid.`);
  }
  const unchangedEntry = plan.currentMenuRevision === null
    ? actualPriceEntry === undefined
    : samePriceEntry(
      actualPriceEntry,
      expectedPriceEntry(menuData, plan.currentMenuRevision),
    );
  if (
    actualPriceEntry !== undefined
    && !unchangedEntry
    && samePriceEntry(actualPriceEntry, plan.priceEntry)
  ) {
    throw new MenuMigrationError(
      `Legacy item "${plan.id}" already has its target entry; current rules require a changed entry.`,
    );
  }

  const batch = writeBatch(database);
  batch.update(menuRef, { menuRevision: plan.menuRevision });

  if (!priceBook) {
    if (plan.currentMenuRevision !== null) {
      throw new MenuMigrationError(
        `Cannot bootstrap a missing price book from non-legacy item "${plan.id}" under current rules.`,
      );
    }
    batch.set(bookRef, {
      revision: 1,
      updatedAt: serverTimestamp(),
      lastChangedMenuItemId: plan.id,
      prices: { [plan.id]: plan.priceEntry },
    });
  } else {
    batch.update(bookRef, {
      revision: priceBook.revision + 1,
      updatedAt: serverTimestamp(),
      lastChangedMenuItemId: plan.id,
      prices: {
        ...priceBook.prices,
        [plan.id]: plan.priceEntry,
      },
    });
  }

  await batch.commit();
}

async function writeInventoryFiles(
  reportDirectory,
  runId,
  catalog,
  mode,
  projectId,
) {
  const backupPath = await writeJsonReport(
    reportDirectory,
    runId,
    "backup",
    {
      runId,
      generatedAt: new Date().toISOString(),
      mode,
      project: projectId,
      menuItems: Object.fromEntries(
        catalog.items.map(({ id, data }) => [id, serializeValue(data)]),
      ),
      priceBook: serializeValue(catalog.priceBook),
      migration: serializeValue(catalog.migration),
    },
  );
  return backupPath;
}

export async function runMenuMigration({
  database,
  operatorUid,
  mode = "dry-run",
  reportDirectory = DEFAULT_REPORT_DIRECTORY,
  expectedProjectId = DEMO_PROJECT_ID,
}) {
  if (!["dry-run", "apply", "finalize"].includes(mode)) {
    throw new MenuMigrationError(`Unsupported migration mode "${mode}".`);
  }
  requireProject(database, expectedProjectId);
  await requireMigrationOperator(database, operatorUid);

  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID()}`;
  let catalog = await loadCatalog(database);
  const backupPath = await writeInventoryFiles(
    reportDirectory,
    runId,
    catalog,
    mode,
    expectedProjectId,
  );
  let audit = makeAuditReport({
    runId,
    mode,
    projectId: expectedProjectId,
    items: catalog.items,
    priceBook: catalog.priceBook,
    migration: catalog.migration,
  });
  let auditPath = await writeJsonReport(
    reportDirectory,
    runId,
    "audit-before",
    audit,
  );

  if (mode === "dry-run") {
    return { runId, backupPath, auditPath, audit };
  }

  if (catalog.migration?.state !== "migrating") {
    throw new MenuMigrationError(
      'Apply/finalize requires menuControl/migration.state to be "migrating".',
    );
  }

  if (audit.issues.length > 0) {
    throw new MenuMigrationError(
      `Migration is blocked by ${audit.issues.length} audit issue(s). See ${auditPath}.`,
    );
  }

  if (mode === "apply") {
    const appliedItemIds = [];
    for (const plan of audit.pendingWrites) {
      try {
        await applyOneItem(database, plan);
        appliedItemIds.push(plan.id);
      } catch (error) {
        const partial = {
          ...audit,
          generatedAt: new Date().toISOString(),
          clean: false,
          appliedItemIds,
          failedItem: plan.id,
          failure: error.message,
        };
        auditPath = await writeJsonReport(
          reportDirectory,
          runId,
          "audit-partial",
          partial,
        );
        throw new MenuMigrationError(
          `Migration stopped at "${plan.id}" after ${appliedItemIds.length} item(s). See backup ${backupPath} and audit ${auditPath}.`,
          { cause: error },
        );
      }
    }

    catalog = await loadCatalog(database);
    audit = makeAuditReport({
      runId,
      mode,
      projectId: expectedProjectId,
      items: catalog.items,
      priceBook: catalog.priceBook,
      migration: catalog.migration,
    });
    audit.appliedItemIds = appliedItemIds;
    auditPath = await writeJsonReport(
      reportDirectory,
      runId,
      "audit-after",
      audit,
    );
    if (!audit.clean) {
      throw new MenuMigrationError(
        `Post-migration audit found issues. See ${auditPath}.`,
      );
    }
    return { runId, backupPath, auditPath, audit };
  }

  if (audit.pendingWrites.length > 0) {
    throw new MenuMigrationError(
      `Finalization is blocked until all ${audit.pendingWrites.length} pending item write(s) are applied.`,
    );
  }

  if (!audit.clean) {
    throw new MenuMigrationError(`Finalization is blocked by audit ${auditPath}.`);
  }

  await updateDoc(doc(database, MIGRATION_PATH), {
    state: "finalizing",
    updatedAt: serverTimestamp(),
    updatedBy: operatorUid,
  });

  catalog = await loadCatalog(database);
  audit = makeAuditReport({
    runId,
    mode,
    projectId: expectedProjectId,
    items: catalog.items,
    priceBook: catalog.priceBook,
    migration: catalog.migration,
  });
  auditPath = await writeJsonReport(
    reportDirectory,
    runId,
    "audit-finalizing",
    audit,
  );
  if (!audit.clean || audit.pendingWrites.length > 0) {
    throw new MenuMigrationError(
      `Finalization stopped in finalizing state because the second audit failed. See ${auditPath}.`,
    );
  }

  await updateDoc(doc(database, MIGRATION_PATH), {
    state: "ready",
    updatedAt: serverTimestamp(),
    updatedBy: operatorUid,
  });

  catalog = await loadCatalog(database);
  audit = makeAuditReport({
    runId,
    mode,
    projectId: expectedProjectId,
    items: catalog.items,
    priceBook: catalog.priceBook,
    migration: catalog.migration,
  });
  auditPath = await writeJsonReport(
    reportDirectory,
    runId,
    "audit-ready",
    audit,
  );
  if (catalog.migration?.state !== "ready" || !audit.clean) {
    throw new MenuMigrationError(
      `Final ready-state audit did not pass. See ${auditPath}.`,
    );
  }

  return { runId, backupPath, auditPath, audit };
}

export async function startMenuMigration({
  database,
  operatorUid,
  expectedProjectId = DEMO_PROJECT_ID,
}) {
  requireProject(database, expectedProjectId);
  await requireMigrationOperator(database, operatorUid);
  const migrationRef = doc(database, MIGRATION_PATH);
  const migrationSnapshot = await getDoc(migrationRef);
  if (migrationSnapshot.exists()) {
    throw new MenuMigrationError(
      `Migration state already exists as "${migrationSnapshot.data().state}".`,
    );
  }

  await setDoc(migrationRef, {
    state: "migrating",
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: operatorUid,
  });
}

function parseArguments(argv) {
  const options = { mode: "dry-run", reportDirectory: DEFAULT_REPORT_DIRECTORY };
  for (const argument of argv) {
    if (argument === "--dry-run") {
      options.mode = "dry-run";
    } else if (argument === "--apply") {
      options.mode = "apply";
    } else if (argument === "--finalize") {
      options.mode = "finalize";
    } else if (argument === "--start") {
      options.mode = "start";
    } else if (argument.startsWith("--report-dir=")) {
      options.reportDirectory = argument.slice("--report-dir=".length);
      if (!options.reportDirectory) {
        throw new MenuMigrationError("--report-dir must not be empty.");
      }
    } else {
      throw new MenuMigrationError(`Unknown argument "${argument}".`);
    }
  }
  if (options.mode === "dry-run" && argv.includes("--apply")) {
    throw new MenuMigrationError("Choose only one migration mode.");
  }
  if (
    argv.filter((argument) =>
      ["--dry-run", "--start", "--apply", "--finalize"].includes(argument),
    ).length > 1
  ) {
    throw new MenuMigrationError("Choose only one migration mode.");
  }
  return options;
}

function requireEmulatorEnvironment() {
  if (
    process.env.FIRESTORE_EMULATOR_HOST
    !== `${FIRESTORE_EMULATOR_HOST}:${FIRESTORE_EMULATOR_PORT}`
    || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
  ) {
    throw new MenuMigrationError(
      "Refusing to run: this utility requires the configured local Firestore and Auth emulators.",
    );
  }
}

async function authenticateEmulator(auth) {
  const email = process.env.MENU_MIGRATION_EMAIL;
  const password = process.env.MENU_MIGRATION_PASSWORD;
  if (!email || !password) {
    throw new MenuMigrationError(
      "Set MENU_MIGRATION_EMAIL and MENU_MIGRATION_PASSWORD for an admin with an enabled emulator migration grant.",
    );
  }

  return signInWithEmailAndPassword(auth, email, password);
}

async function main() {
  let app;
  try {
    requireEmulatorEnvironment();
    const options = parseArguments(process.argv.slice(2));
    app = initializeApp(
      {
        apiKey: "local-emulator-only",
        authDomain: `${DEMO_PROJECT_ID}.firebaseapp.com`,
        projectId: DEMO_PROJECT_ID,
      },
      `menu-migration-${randomUUID()}`,
    );
    const auth = getAuth(app);
    const database = getFirestore(app);
    connectAuthEmulator(auth, AUTH_EMULATOR_URL, { disableWarnings: true });
    connectFirestoreEmulator(
      database,
      FIRESTORE_EMULATOR_HOST,
      FIRESTORE_EMULATOR_PORT,
    );
    const credential = await authenticateEmulator(auth);
    if (options.mode === "start") {
      await startMenuMigration({
        database,
        operatorUid: credential.user.uid,
      });
      console.log('Migration state created as "migrating".');
      return;
    }

    const result = await runMenuMigration({
      database,
      operatorUid: credential.user.uid,
      mode: options.mode,
      reportDirectory: options.reportDirectory,
    });
    console.log(JSON.stringify({
      mode: options.mode,
      clean: result.audit.clean,
      menuItemCount: result.audit.menuItemCount,
      pendingWrites: result.audit.pendingWrites.length,
      issues: result.audit.issues.length,
      backupPath: result.backupPath,
      auditPath: result.auditPath,
    }, null, 2));
  } catch (error) {
    console.error(`Menu migration stopped: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (app) await deleteApp(app);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
