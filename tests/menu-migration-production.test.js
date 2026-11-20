import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertProductionTarget,
  parseProductionMigrationArguments,
} from "../scripts/menu-migration-production.js";

describe("production menu migration guards", () => {
  it("defaults to a read-only dry run and external report directory", () => {
    const options = parseProductionMigrationArguments([]);

    assert.equal(options.mode, "dry-run");
    assert.equal(options.confirmed, false);
    assert.match(options.reportDirectory, /CactusCafeMigrationReports$/);
  });

  it("parses exactly one explicit migration mode", () => {
    const options = parseProductionMigrationArguments([
      "--start",
      "--confirm-production",
      "--report-dir=C:\\CactusCafeMigrationReports",
    ]);

    assert.equal(options.mode, "start");
    assert.equal(options.confirmed, true);
    assert.equal(options.reportDirectory, "C:\\CactusCafeMigrationReports");
    assert.throws(
      () => parseProductionMigrationArguments(["--start", "--apply"]),
      /Choose only one migration mode/,
    );
    assert.throws(
      () => parseProductionMigrationArguments(["--unknown"]),
      /Unsupported argument/,
    );
    assert.throws(
      () => parseProductionMigrationArguments(["--report-dir="]),
      /must not be empty/,
    );
  });

  it("refuses other projects and any configured Firebase emulator", () => {
    assert.doesNotThrow(() => assertProductionTarget({
      projectId: "cactus-cafev1",
    }));
    assert.throws(
      () => assertProductionTarget({ projectId: "demo-cactus-cafe" }),
      /outside production project/,
    );
    assert.throws(
      () => assertProductionTarget({
        projectId: "cactus-cafev1",
        firestoreEmulatorHost: "127.0.0.1:8080",
      }),
      /emulator environment/,
    );
    assert.throws(
      () => assertProductionTarget({
        projectId: "cactus-cafev1",
        authEmulatorHost: "127.0.0.1:9099",
      }),
      /emulator environment/,
    );
  });
});
