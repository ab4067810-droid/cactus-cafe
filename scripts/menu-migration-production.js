import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { deleteApp, initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

import {
  captureMenuBackup,
  PROJECT_CONFIG,
} from "./firestore-menu-backup.js";
import {
  runMenuMigration,
  startMenuMigration,
} from "./menu-migration.js";

const PROJECT_ID = PROJECT_CONFIG.projectId;
const DEFAULT_REPORT_DIRECTORY = join(
  homedir(),
  "CactusCafeMigrationReports",
);

const ACTION_CONFIRMATIONS = {
  start: `START MIGRATION ${PROJECT_ID}`,
  apply: `APPLY MIGRATION ${PROJECT_ID}`,
  finalize: `FINALIZE MIGRATION ${PROJECT_ID}`,
};

export class ProductionMenuMigrationError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ProductionMenuMigrationError";
  }
}

export function parseProductionMigrationArguments(argv) {
  const options = {
    mode: "dry-run",
    confirmed: false,
    reportDirectory: DEFAULT_REPORT_DIRECTORY,
  };
  let modeWasSelected = false;

  for (const argument of argv) {
    if (argument === "--confirm-production") {
      options.confirmed = true;
    } else if (argument === "--dry-run") {
      if (modeWasSelected) {
        throw new ProductionMenuMigrationError(
          "Choose only one migration mode.",
        );
      }
      options.mode = "dry-run";
      modeWasSelected = true;
    } else if (argument === "--start") {
      if (modeWasSelected) {
        throw new ProductionMenuMigrationError(
          "Choose only one migration mode.",
        );
      }
      options.mode = "start";
      modeWasSelected = true;
    } else if (argument === "--apply") {
      if (modeWasSelected) {
        throw new ProductionMenuMigrationError(
          "Choose only one migration mode.",
        );
      }
      options.mode = "apply";
      modeWasSelected = true;
    } else if (argument === "--finalize") {
      if (modeWasSelected) {
        throw new ProductionMenuMigrationError(
          "Choose only one migration mode.",
        );
      }
      options.mode = "finalize";
      modeWasSelected = true;
    } else if (argument.startsWith("--report-dir=")) {
      options.reportDirectory = argument.slice("--report-dir=".length);
      if (!options.reportDirectory) {
        throw new ProductionMenuMigrationError(
          "--report-dir must not be empty.",
        );
      }
    } else {
      throw new ProductionMenuMigrationError(
        `Unsupported argument "${argument}".`,
      );
    }
  }

  return options;
}

export function assertProductionTarget({
  projectId,
  firestoreEmulatorHost,
  authEmulatorHost,
}) {
  if (projectId !== PROJECT_ID) {
    throw new ProductionMenuMigrationError(
      `Refusing to run outside production project "${PROJECT_ID}".`,
    );
  }
  if (firestoreEmulatorHost || authEmulatorHost) {
    throw new ProductionMenuMigrationError(
      "Refusing to run while a Firebase emulator environment is configured.",
    );
  }
}

async function requireTypedConfirmation(phrase, description) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new ProductionMenuMigrationError(
      `An interactive terminal is required. Type "${phrase}" when prompted.`,
    );
  }

  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await terminal.question(
      `${description}\nType exactly "${phrase}" to continue: `,
    );
    if (answer !== phrase) {
      throw new ProductionMenuMigrationError(
        "Production confirmation did not match.",
      );
    }
  } finally {
    terminal.close();
  }
}

function assertPreflightAllowsMode(mode, audit, auditPath) {
  if (audit.issues.length > 0) {
    throw new ProductionMenuMigrationError(
      `Migration is blocked by ${audit.issues.length} audit issue(s). Review ${auditPath} before continuing.`,
    );
  }

  if (mode === "start" && audit.migrationState !== null) {
    throw new ProductionMenuMigrationError(
      `Cannot start migration because its state is already "${audit.migrationState}".`,
    );
  }

  if (
    ["apply", "finalize"].includes(mode)
    && audit.migrationState !== "migrating"
  ) {
    throw new ProductionMenuMigrationError(
      `Cannot ${mode} because migration state is not "migrating".`,
    );
  }

  if (
    mode === "finalize"
    && (audit.pendingWrites.length > 0 || !audit.clean)
  ) {
    throw new ProductionMenuMigrationError(
      "Finalization requires a clean audit with no pending writes.",
    );
  }
}

async function runProductionWorkflow({
  database,
  operatorUid,
  options,
}) {
  const backupResult = await captureMenuBackup({
    database,
    outputDirectory: options.reportDirectory,
  });
  if (!backupResult.backup.completenessReport.complete) {
    throw new ProductionMenuMigrationError(
      "The production backup is incomplete; no migration operation was attempted.",
    );
  }
  const reportDirectory = dirname(backupResult.filePath);
  const preview = await runMenuMigration({
    database,
    operatorUid,
    mode: "dry-run",
    reportDirectory,
    expectedProjectId: PROJECT_ID,
  });

  if (options.mode === "dry-run") {
    return {
      mode: options.mode,
      backupPath: backupResult.filePath,
      backupSha256: backupResult.backup.sha256,
      backupCatalogConsistent:
        backupResult.backup.completenessReport.catalogConsistent,
      auditPath: preview.auditPath,
      audit: preview.audit,
    };
  }

  console.log(JSON.stringify({
    projectId: PROJECT_ID,
    mode: options.mode,
    migrationState: preview.audit.migrationState,
    catalogBackupPath: backupResult.filePath,
    catalogBackupSha256: backupResult.backup.sha256,
    backupCatalogConsistent:
      backupResult.backup.completenessReport.catalogConsistent,
    auditPath: preview.auditPath,
    clean: preview.audit.clean,
    menuItemCount: preview.audit.menuItemCount,
    pendingWrites: preview.audit.pendingWrites.length,
    issues: preview.audit.issues.length,
  }, null, 2));
  assertPreflightAllowsMode(
    options.mode,
    preview.audit,
    preview.auditPath,
  );
  await requireTypedConfirmation(
    ACTION_CONFIRMATIONS[options.mode],
    `This will ${options.mode} the menu migration in production project "${PROJECT_ID}".`,
  );

  if (options.mode === "start") {
    await startMenuMigration({
      database,
      operatorUid,
      expectedProjectId: PROJECT_ID,
    });
    return {
      mode: options.mode,
      state: "migrating",
      backupPath: backupResult.filePath,
      backupSha256: backupResult.backup.sha256,
      backupCatalogConsistent:
        backupResult.backup.completenessReport.catalogConsistent,
      auditPath: preview.auditPath,
      audit: preview.audit,
    };
  }

  const result = await runMenuMigration({
    database,
    operatorUid,
    mode: options.mode,
    reportDirectory,
    expectedProjectId: PROJECT_ID,
  });
  return {
    mode: options.mode,
    backupPath: backupResult.filePath,
    backupSha256: backupResult.backup.sha256,
    backupCatalogConsistent:
      backupResult.backup.completenessReport.catalogConsistent,
    auditPath: result.auditPath,
    audit: result.audit,
  };
}

async function main() {
  let app;
  try {
    const options = parseProductionMigrationArguments(
      process.argv.slice(2),
    );
    if (!options.confirmed) {
      throw new ProductionMenuMigrationError(
        "Refusing to connect: pass --confirm-production and confirm the project interactively.",
      );
    }

    assertProductionTarget({
      projectId: PROJECT_ID,
      firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
      authEmulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
    });

    const email = process.env.CACTUS_MIGRATION_EMAIL;
    const password = process.env.CACTUS_MIGRATION_PASSWORD;
    if (!email || !password) {
      throw new ProductionMenuMigrationError(
        "Set CACTUS_MIGRATION_EMAIL and CACTUS_MIGRATION_PASSWORD for an enabled admin migration operator.",
      );
    }

    await requireTypedConfirmation(
      `CONNECT ${PROJECT_ID}`,
      `This will connect to production Firestore project "${PROJECT_ID}", create a local backup, and audit the catalog.`,
    );

    app = initializeApp(PROJECT_CONFIG, `menu-migration-${Date.now()}`);
    const auth = getAuth(app);
    const database = getFirestore(app);
    assertProductionTarget({
      projectId: database.app.options.projectId,
      firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
      authEmulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
    });

    const credential = await signInWithEmailAndPassword(
      auth,
      email,
      password,
    );
    const result = await runProductionWorkflow({
      database,
      operatorUid: credential.user.uid,
      options,
    });

    console.log(JSON.stringify({
      projectId: PROJECT_ID,
      mode: result.mode,
      state: result.state ?? result.audit.migrationState,
      clean: result.audit.clean,
      menuItemCount: result.audit.menuItemCount,
      pendingWrites: result.audit.pendingWrites.length,
      issues: result.audit.issues.length,
      backupPath: result.backupPath,
      backupSha256: result.backupSha256,
      backupCatalogConsistent: result.backupCatalogConsistent,
      auditPath: result.auditPath,
    }, null, 2));
  } catch (error) {
    console.error(
      `Production menu migration stopped: ${error?.message || String(error)}`,
    );
    process.exitCode = 1;
  } finally {
    if (app) await deleteApp(app);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
