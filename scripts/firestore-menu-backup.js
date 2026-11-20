import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  Bytes,
  DocumentReference,
  GeoPoint,
  Timestamp,
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
} from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { deleteApp, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { createInterface } from "node:readline/promises";

export const PROJECT_CONFIG = {
  apiKey: "AIzaSyBxALHO0ApnlD_Sp9BsrJxSNhc-3F3g8fc",
  authDomain: "cactus-cafev1.firebaseapp.com",
  projectId: "cactus-cafev1",
  storageBucket: "cactus-cafev1.firebasestorage.app",
  messagingSenderId: "215493411258",
  appId: "1:215493411258:web:4f88898eb9af7c2e215d83",
};
const MENU_COLLECTION = "menuItems";
const PRICE_BOOK_PATH = "menuControl/current";
const MIGRATION_PATH = "menuControl/migration";
const SERIALIZED_TYPE_KEY = "__firestoreBackupType";
const DEFAULT_BACKUP_DIRECTORY = join(homedir(), "CactusCafeFirestoreBackups");
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIRMATION_PHRASE = `BACK UP ${PROJECT_CONFIG.projectId}`;

export class MenuBackupError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "MenuBackupError";
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function serializeMap(value) {
  const entries = Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, serializeFirestoreValue(value[key])]),
  );
  if (Object.hasOwn(value, SERIALIZED_TYPE_KEY)) {
    return {
      [SERIALIZED_TYPE_KEY]: "map",
      entries,
    };
  }
  return entries;
}

export function serializeFirestoreValue(value) {
  if (value instanceof Timestamp) {
    return {
      [SERIALIZED_TYPE_KEY]: "timestamp",
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
    };
  }
  if (value instanceof GeoPoint) {
    return {
      [SERIALIZED_TYPE_KEY]: "geopoint",
      latitude: value.latitude,
      longitude: value.longitude,
    };
  }
  if (value instanceof Bytes) {
    return {
      [SERIALIZED_TYPE_KEY]: "bytes",
      base64: value.toBase64(),
    };
  }
  if (value instanceof DocumentReference) {
    return {
      [SERIALIZED_TYPE_KEY]: "reference",
      projectId: value.firestore.app.options.projectId,
      path: value.path,
    };
  }
  if (Array.isArray(value)) return value.map(serializeFirestoreValue);
  if (isRecord(value)) return serializeMap(value);
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function priceCentsFor(menuItem) {
  return Math.round(menuItem.price * 100);
}

function priceBookEntryIsValid(entry) {
  return isRecord(entry)
    && Object.keys(entry).length === 3
    && Number.isInteger(entry.priceCents)
    && entry.priceCents >= 0
    && entry.priceCents <= 100000000
    && typeof entry.available === "boolean"
    && Number.isInteger(entry.menuRevision)
    && entry.menuRevision >= 1;
}

function validPriceBook(priceBook) {
  return isRecord(priceBook)
    && Object.keys(priceBook).length === 4
    && Object.hasOwn(priceBook, "revision")
    && Object.hasOwn(priceBook, "updatedAt")
    && Object.hasOwn(priceBook, "lastChangedMenuItemId")
    && Object.hasOwn(priceBook, "prices")
    && Number.isInteger(priceBook.revision)
    && priceBook.revision >= 1
    && priceBook.updatedAt instanceof Timestamp
    && typeof priceBook.lastChangedMenuItemId === "string"
    && priceBook.lastChangedMenuItemId.length > 0
    && isRecord(priceBook.prices);
}

export function inspectMenuBackup({ menuDocuments, priceBook, migration }) {
  const documentIds = menuDocuments
    .map(({ id }) => id)
    .sort((left, right) => left.localeCompare(right));
  const issues = [];

  if (priceBook !== null && !validPriceBook(priceBook)) {
    issues.push({
      code: "invalid-price-book",
      message: "menuControl/current is missing required fields or has invalid values.",
    });
  } else if (priceBook === null) {
    issues.push({
      code: "missing-price-book",
      message: "menuControl/current does not exist.",
    });
  }

  if (
    migration !== null
    && (
    !isRecord(migration)
    || Object.keys(migration).length !== 4
    || !Object.hasOwn(migration, "state")
    || !Object.hasOwn(migration, "startedAt")
    || !Object.hasOwn(migration, "updatedAt")
    || !Object.hasOwn(migration, "updatedBy")
    || !["migrating", "finalizing", "ready"].includes(migration.state)
    || !(migration.startedAt instanceof Timestamp)
    || !(migration.updatedAt instanceof Timestamp)
    || typeof migration.updatedBy !== "string"
    )
  ) {
    issues.push({
      code: "invalid-migration-state",
      message: "menuControl/migration does not match the expected schema.",
    });
  }
  if (migration === null) {
    issues.push({
      code: "missing-migration-state",
      message: "menuControl/migration does not exist.",
    });
  } else if (isRecord(migration) && migration.state !== "ready") {
    issues.push({
      code: "migration-not-ready",
      message: `menuControl/migration state is "${migration.state ?? "missing"}", not "ready".`,
    });
  }

  const prices = validPriceBook(priceBook) ? priceBook.prices : {};
  const itemIds = new Set(documentIds);
  const menuChecks = menuDocuments.map(({ id, data }) => {
    const itemIssues = [];
    if (typeof data.price !== "number" || !Number.isFinite(data.price) || data.price < 0) {
      itemIssues.push("Menu price is missing or invalid.");
    }
    if (typeof data.available !== "boolean") {
      itemIssues.push("Menu availability is missing or invalid.");
    }
    if (!Number.isInteger(data.menuRevision) || data.menuRevision < 1) {
      itemIssues.push("menuRevision is missing or invalid.");
    }
    const entry = prices[id];
    if (!priceBookEntryIsValid(entry)) {
      itemIssues.push(entry === undefined
        ? "Price-book entry is missing."
        : "Price-book entry is invalid.");
    }
    if (
      typeof data.price === "number"
      && Number.isFinite(data.price)
      && priceBookEntryIsValid(entry)
      && entry.priceCents !== priceCentsFor(data)
    ) {
      itemIssues.push("Price-book cents do not match the menu price.");
    }
    if (
      typeof data.available === "boolean"
      && priceBookEntryIsValid(entry)
      && entry.available !== data.available
    ) {
      itemIssues.push("Price-book availability does not match the menu item.");
    }
    if (
      Number.isInteger(data.menuRevision)
      && priceBookEntryIsValid(entry)
      && entry.menuRevision !== data.menuRevision
    ) {
      itemIssues.push("Price-book revision does not match the menu item.");
    }
    for (const message of itemIssues) {
      issues.push({ id, code: "menu-price-book-mismatch", message });
    }
    return { id, consistent: itemIssues.length === 0, issues: itemIssues };
  });

  for (const id of Object.keys(prices).sort((a, b) => a.localeCompare(b))) {
    if (!itemIds.has(id)) {
      issues.push({
        id,
        code: "orphan-price-entry",
        message: "Price-book entry has no corresponding menuItems document.",
      });
    }
  }

  const migrationIssueCodes = new Set([
    "invalid-migration-state",
    "missing-migration-state",
    "migration-not-ready",
  ]);
  return {
    complete: true,
    catalogConsistent: !issues.some(
      (issue) => !migrationIssueCodes.has(issue.code),
    ),
    menuItemCount: menuDocuments.length,
    documentIds,
    menuDocumentsEnumerated: true,
    priceBookDocumentRead: priceBook !== undefined,
    migrationDocumentRead: migration !== undefined,
    migrationStateExists: migration !== null,
    menuChecks,
    issues,
  };
}

export function createMenuBackup({
  menuDocuments,
  priceBook,
  migration,
  generatedAt = new Date().toISOString(),
  projectId = PROJECT_CONFIG.projectId,
}) {
  const sortedDocuments = [...menuDocuments]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ id, data }) => ({ id, fields: serializeFirestoreValue(data) }));
  const report = inspectMenuBackup({ menuDocuments, priceBook, migration });
  const payload = {
    formatVersion: 1,
    projectId,
    generatedAt,
    documentCount: sortedDocuments.length,
    documentIds: report.documentIds,
    menuItems: sortedDocuments,
    menuControl: {
      current: priceBook === null ? null : serializeFirestoreValue(priceBook),
      migration: migration === null ? null : serializeFirestoreValue(migration),
    },
    completenessReport: report,
  };
  const canonicalJson = JSON.stringify(canonicalize(payload));
  return {
    ...payload,
    sha256: createHash("sha256").update(canonicalJson, "utf8").digest("hex"),
  };
}

function ensureOutsideProject(outputDirectory) {
  const absoluteDirectory = resolve(outputDirectory);
  if (isInsideDirectory(PROJECT_ROOT, absoluteDirectory)) {
    throw new MenuBackupError(
      `Backup directory must be outside the project/public web root: ${absoluteDirectory}`,
    );
  }
  return absoluteDirectory;
}

function isInsideDirectory(root, target) {
  const fromRoot = relative(root, target);
  return fromRoot === ""
    || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot));
}

export async function captureMenuBackup({
  database,
  outputDirectory = DEFAULT_BACKUP_DIRECTORY,
  generatedAt,
}) {
  const directory = ensureOutsideProject(outputDirectory);
  await mkdir(directory, { recursive: true });
  const [projectRoot, realDirectory] = await Promise.all([
    realpath(PROJECT_ROOT),
    realpath(directory),
  ]);
  if (isInsideDirectory(projectRoot, realDirectory)) {
    throw new MenuBackupError(
      `Backup directory resolves inside the project/public web root: ${realDirectory}`,
    );
  }
  const [menuSnapshot, priceBookSnapshot, migrationSnapshot] = await Promise.all([
    getDocsFromServer(collection(database, MENU_COLLECTION)),
    getDocFromServer(doc(database, PRICE_BOOK_PATH)),
    getDocFromServer(doc(database, MIGRATION_PATH)),
  ]);
  const backup = createMenuBackup({
    menuDocuments: menuSnapshot.docs.map((snapshot) => ({
      id: snapshot.id,
      data: snapshot.data(),
    })),
    priceBook: priceBookSnapshot.exists() ? priceBookSnapshot.data() : null,
    migration: migrationSnapshot.exists() ? migrationSnapshot.data() : null,
    generatedAt,
    projectId: database.app.options.projectId,
  });
  const fileTimestamp = backup.generatedAt.replaceAll(/[:.]/g, "-");
  const filePath = join(
    realDirectory,
    `cactus-cafe-firestore-menu-${fileTimestamp}.json`,
  );
  await writeFile(filePath, `${JSON.stringify(backup, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return { filePath, backup };
}

function parseArguments(argv) {
  const options = {
    confirmed: false,
    outputDirectory: DEFAULT_BACKUP_DIRECTORY,
  };
  for (const argument of argv) {
    if (argument === "--confirm-production") {
      options.confirmed = true;
    } else if (argument.startsWith("--output-dir=")) {
      options.outputDirectory = argument.slice("--output-dir=".length);
      if (!options.outputDirectory) {
        throw new MenuBackupError("--output-dir must not be empty.");
      }
    } else {
      throw new MenuBackupError(`Unsupported argument "${argument}".`);
    }
  }
  return options;
}

async function requireTypedConfirmation() {
  if (!process.stdin.isTTY) {
    throw new MenuBackupError(
      `Production backup requires an interactive terminal. Type "${CONFIRMATION_PHRASE}" when prompted.`,
    );
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question(
      `This will READ production Firestore project "${PROJECT_CONFIG.projectId}" and save a local backup. No Firestore writes are performed.\nType exactly "${CONFIRMATION_PHRASE}" to continue: `,
    );
    if (answer !== CONFIRMATION_PHRASE) {
      throw new MenuBackupError("Production project confirmation did not match.");
    }
  } finally {
    terminal.close();
  }
}

async function main() {
  let app;
  try {
    const options = parseArguments(process.argv.slice(2));
    if (!options.confirmed) {
      throw new MenuBackupError(
        "Refusing to connect: pass --confirm-production and confirm the project interactively.",
      );
    }
    const email = process.env.CACTUS_BACKUP_EMAIL;
    const password = process.env.CACTUS_BACKUP_PASSWORD;
    if (!email || !password) {
      throw new MenuBackupError(
        "Set CACTUS_BACKUP_EMAIL and CACTUS_BACKUP_PASSWORD for the existing Firebase admin account.",
      );
    }
    ensureOutsideProject(options.outputDirectory);
    await requireTypedConfirmation();

    app = initializeApp(PROJECT_CONFIG, `menu-backup-${Date.now()}`);
    const auth = getAuth(app);
    const database = getFirestore(app);
    await signInWithEmailAndPassword(auth, email, password);
    const { filePath, backup } = await captureMenuBackup({
      database,
      outputDirectory: options.outputDirectory,
    });
    console.log(JSON.stringify({
      projectId: backup.projectId,
      documentCount: backup.documentCount,
      sha256: backup.sha256,
      complete: backup.completenessReport.complete,
      catalogConsistent: backup.completenessReport.catalogConsistent,
      issues: backup.completenessReport.issues.length,
      backupPath: filePath,
    }, null, 2));
    if (!backup.completenessReport.catalogConsistent) process.exitCode = 2;
  } catch (error) {
    console.error(`Firestore menu backup stopped: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (app) await deleteApp(app);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
