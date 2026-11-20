# Price Book Migration Procedure

This procedure covers the emulator-only migration utility and the separately guarded production workflow. Neither runs automatically during builds, tests, or deployment.

## Local emulator utility

The script in `scripts/menu-migration.js` hard-codes a demo project and local Auth/Firestore emulator endpoints. It refuses to run unless both emulator environment variables point to those endpoints. Do not remove or bypass those checks, substitute production credentials, or treat a successful emulator run as authorization to change production data.

1. Install the project dependencies and start the current-rules Auth and Firestore emulators by running `npm run test:firestore:menu-migration`. This runs the isolated rules tests and shuts the emulators down when the tests finish. For manual utility use, start the emulators in another terminal with `npx firebase emulators:start --project demo-cactus-cafe-menu-migration --config firebase.menu-migration.emulator.json --only firestore,auth`.
2. Create an Auth Emulator user for local testing, and seed a matching `users/{uid}` document with `role: "admin"` and `migrationOperators/{uid}` with `enabled: true` using emulator-only administrative setup. The grant collection is deliberately not writable by client rules.
3. Set `MENU_MIGRATION_EMAIL` and `MENU_MIGRATION_PASSWORD` to that emulator user's credentials in the same terminal used for the commands below. Never use production credentials.
4. Run `npm run menu:migration` for a dry run (the default). Add `-- --report-dir=<local-directory>` to choose another report location. It writes a full JSON inventory backup and audit report; inspect both before any apply.
5. To test state transitions locally, run `npm run menu:migration -- --start`, then `npm run menu:migration -- --apply`, inspect the generated post-migration audit, and only then run `npm run menu:migration -- --finalize`. Apply batches one menu item at a time; each item and its price-book entry are written atomically. Do not run these commands against a production endpoint.
6. Preserve the emulator backup and final audit reports as test evidence. The default report directory is ignored by Git.

The tests load the repository's current `firestore.rules`; they test dry-run behavior, legacy backfill, price-book bootstrap and preservation, audit/finalization gating, migration state creation, and an unauthorized account.

## Guarded production migration utility

The separate `scripts/menu-migration-production.js` workflow is limited to the configured `cactus-cafev1` project. It uses Firebase client authentication and the deployed Firestore rules; it does not use the Admin SDK or bypass the operator grant. It refuses to connect when emulator environment variables are set.

Before using it:

- A trusted project owner must provision `users/{uid}` with `role: "admin"` and `migrationOperators/{uid}` with `enabled: true`. Client-side grant writes remain denied.
- Obtain project-owner/reviewer approval, and retain an independently recoverable export before applying changes.
- Set `CACTUS_MIGRATION_EMAIL` and `CACTUS_MIGRATION_PASSWORD` in the local terminal. Never place credentials in source code or commit them.
- Use an interactive terminal and inspect every backup and audit report. Reports are written outside the project by default to `~/CactusCafeMigrationReports`.

Commands require `--confirm-production` and an exact interactive project confirmation. Every write phase also requires its own typed confirmation:

1. `npm run menu:migration:production -- --confirm-production --dry-run` creates a hashed inventory backup and migration audit without changing Firestore.
2. `npm run menu:migration:production -- --confirm-production --start` rechecks the catalog and creates the `migrating` state only if there are no audit issues.
3. `npm run menu:migration:production -- --confirm-production --apply` rechecks and backs up again, then updates each legacy menu item and its price-book entry in one atomic batch. It stops on the first failure and retains partial audit evidence.
4. `npm run menu:migration:production -- --confirm-production --finalize` proceeds only with a clean audit and no pending writes. It freezes writes in `finalizing`, audits again, and only then transitions to `ready`.

The production workflow never creates the operator grant. It blocks invalid menu items, orphan price entries, and unsupported cases such as a missing price book with already-revisioned menu items. Review the generated backup and audit before each confirmed write phase. Do not manually set `menuControl/migration.state` to `ready` or manually edit paired menu/price-book documents.

## Read-only production backup

The separate `scripts/firestore-menu-backup.js` CLI reads the configured `cactus-cafev1` project only after an explicit command-line opt-in and interactive confirmation. It requires the existing Firebase Auth admin account via `CACTUS_BACKUP_EMAIL` and `CACTUS_BACKUP_PASSWORD`. It reads the full `menuItems` collection and gets `menuControl/current` and `menuControl/migration` individually; it contains no Firestore write operations. By default, it writes to `~/CactusCafeFirestoreBackups`, outside the application. An alternate `--output-dir` must also resolve outside the project directory.

Emulator-only fixture tests run with `npm run test:firestore:menu-backup`. To request a production backup, first review the source and verify the configured project and output destination. In an interactive terminal, set the two credential environment variables and run `npm run firestore:menu-backup -- --confirm-production`; the CLI then requires typing `BACK UP cactus-cafev1` before it initializes Firebase or signs in. It prints the output path, SHA-256, count, completeness status, catalog-consistency status, and issue count. An inconsistent catalog snapshot is still written for diagnosis but exits with status 2; retain and review its report rather than treating it as a migration-ready backup.

The hash covers canonicalized JSON payload data excluding the `sha256` field. The backup contains sorted document IDs, all menu fields, and tagged Firestore special values including timestamps represented by exact seconds and nanoseconds as returned by the SDK. The completeness report distinguishes successful inventory capture from catalog consistency; a missing migration-state document is recorded as absent, not as a failed read. It checks each available price-book entry against item price cents, availability and revision, missing entries, and orphan entries. This client-SDK read is not an atomic point-in-time database export: pause catalog writes during capture and verify a second inventory before relying on the backup. Client pagination limits and very large catalogs may require a separately reviewed paginated approach. The backup format is not a restore tool; no restore command is implemented, and restoring must respect paired writes and revision rules.

## Production-use prerequisites

The production-capable workflow is deliberately opt-in and was not run against production as part of this change. Before any production migration, a project owner and reviewer must approve the operation, confirm a recoverable export/backup, verify the published rules and operator grant, and rehearse the entire workflow against a production-shaped emulator dataset. Never use the emulator-only CLI against production or manually edit paired menu and price-book documents in the console.

## Required migration sequence

1. **Authorize the migration operator.** For a separately approved production workflow, a trusted project owner provisions the operator's `migrationOperators/{uid}` grant outside client Firestore access. Verify the operator also has the required administrator role.
2. **Enter `migrating`.** The authorized operator initializes the migration state. Order approval remains blocked.
3. **Backfill and pair menu data.** For every legacy menu item, make the required menu revision change and matching price-book entry in the same atomic batch. Resolve each write failure rather than bypassing the rules.
4. **Audit every menu item.** Enumerate the complete `menuItems` collection and compare every item with `menuControl/current.prices` using its document ID. Verify:
   - Every menu item has exactly one corresponding price-book entry.
   - The price matches after converting the menu's peso price to integer centavos.
   - Availability matches.
   - `menuRevision` matches.
   - There are no extra price-book entries for missing menu items.
5. **Resolve all discrepancies.** Correct missing, extra, or mismatched entries using valid paired writes while state is `migrating`. Repeat the full audit until all comparisons pass.
6. **Freeze catalog changes.** The authorized operator changes state from `migrating` to `finalizing`. Menu and price-book writes are then denied. If the audit discovers a discrepancy after freezing, do not mark the book ready; use a separately reviewed recovery procedure rather than weakening the rules or editing around the freeze.
7. **Reconfirm completeness and activate.** With catalog writes frozen, verify the collection inventory and every price, availability, revision, and ID comparison once more. Only after that verification should the authorized operator transition `finalizing` to `ready`. Approval is enabled only in `ready`.
8. **Retain audit evidence.** Record the audit date, operator identity, item count, comparison outcome, discrepancy resolutions, and the final price-book revision in the project's controlled operational records.

## Security limitation

Firestore Security Rules cannot query and compare an entire collection to independently prove that the migration is complete. They can enforce operator authorization, ordered state transitions, paired menu/price-book writes, and the `ready` approval gate, but they cannot establish that an operator's collection-wide audit was exhaustive. Therefore, `ready` is a trusted operator assertion. Do not transition to `ready` unless the external audit above has completed successfully.

The migration operator grant must not be writable through client-facing Firestore rules. Provisioning or revoking that grant is a trusted project-owner operation.
