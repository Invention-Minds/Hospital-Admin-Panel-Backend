# Sprint 4a · Phase 1a — Migration Bundle Plan

**Date:** 2026-04-20 · **Status:** Plan only. Awaiting user approval before running `prisma migrate deploy`.

**Scope:** a single hand-written migration bundling three additive schema changes, per [sprint-4a-plan.md](./sprint-4a-plan.md) §Phase 1. All three changes are nullable — zero existing row invalidation, zero data mutation.

---

## Three changes in this bundle

### Change 1 — MRD audit: typed creator id across clinical models

**Proposal: Option A** (recommended in the parent plan; not yet approved). Add `createdById INT NULL` to **7 clinical models**:

| Model | Line | Current audit columns |
|---|---|---|
| `IpdProgressNote` | 1491 | `createdAt DateTime @default(now())`, `createdBy String?` |
| `IpdDischarge` | 1516 | `createdAt`, `createdBy` |
| `IpdPrescription` | 1541 | `createdAt`, `updatedAt`, `createdBy`, `updatedBy` |
| `IpdMedicationLog` | 1579 | `createdAt`, `createdBy` (inferred; need to re-read) |
| `MlcCase` | 1273 | `createdAt`, `updatedAt`, `createdBy`, `updatedBy` |
| `LamaRecord` | 1323 | `createdAt`, `createdBy` |
| `DamaRecord` | 1346 | `createdAt`, `createdBy` |

**Why:** current `createdBy String?` stores free-text usernames — unbounded, unindexed for audit queries, no referential integrity. NABH MRD.2 / MRD.3 audits benefit from a typed id that ties back to the `User` table (id Int). The enforcement logic (Item 1 in Phase 1b) will require the new `createdById` to be populated on every write to these models.

**Why no `@relation`:** keeping it as a bare `Int?` (like `IpdAdmission.referralOpdId: String?`) avoids cascade/restrict decisions + back-relation fields on the `User` model. Referential integrity is application-layer; Prisma treats it as a typed-but-loose pointer. Consistent with existing patterns in the schema.

**Why not also `updatedById`:** simpler scope. The update-tracking pattern can be added in 4b if needed. Create-time attribution is the NABH minimum.

### Change 2 — `IpdDischarge.doctorSignature String?`

Single column add to `IpdDischarge` (line 1516). NABH MRD.3 requires the discharging doctor's signature on the discharge summary. Current schema has no such field; the generated PDF (Phase 2, Item 4) needs something to render.

Field stores a signature reference — URL or GCS path, matching the existing `patientSignature String?` / `witnessSignature String?` convention on `LamaRecord` / `DamaRecord` (lines 1330 / 1353).

### Change 3 — `IpdPrescription.modificationReason String?`

Single column add to `IpdPrescription` (line 1541). NABH MOM.4 (medication review) expects a documented rationale when an active prescription is modified (dose change, route change, discontinue). Nullable add; existing rows are valid.

Field captures free-text clinician input, enforced at controller layer when an update endpoint mutates the prescription.

---

## Proposed migration.sql

**Directory:** `prisma/migrations/20260420130000_mrd_audit_and_signature_bundle/migration.sql`

```sql
-- Sprint 4a · Phase 1a — MRD audit columns + doctor signature + modification reason
-- All changes are nullable ADD COLUMN. Zero row rewrite under MySQL 8.0+ INSTANT algorithm.

-- Change 1: MRD audit — typed createdById across 7 clinical models
ALTER TABLE `IpdProgressNote`  ADD COLUMN `createdById` INT NULL;
ALTER TABLE `IpdDischarge`     ADD COLUMN `createdById` INT NULL;
ALTER TABLE `IpdPrescription`  ADD COLUMN `createdById` INT NULL;
ALTER TABLE `IpdMedicationLog` ADD COLUMN `createdById` INT NULL;
ALTER TABLE `MlcCase`          ADD COLUMN `createdById` INT NULL;
ALTER TABLE `LamaRecord`       ADD COLUMN `createdById` INT NULL;
ALTER TABLE `DamaRecord`       ADD COLUMN `createdById` INT NULL;

-- Change 2: doctor-signature on discharge summary (NABH MRD.3)
ALTER TABLE `IpdDischarge`     ADD COLUMN `doctorSignature` VARCHAR(191) NULL;

-- Change 3: modification reason on IPD prescriptions (NABH MOM.4)
ALTER TABLE `IpdPrescription`  ADD COLUMN `modificationReason` VARCHAR(191) NULL;
```

**Total: 9 ALTER TABLE statements across 7 tables.**

Table name conventions match existing migrations (e.g., 20260418140000 which uses `DamaRecord` / `LamaRecord` — Pascal-case, matching Prisma model names). I verified this against the last 4 migration files for consistency.

---

## Prisma schema patches (staged alongside migration.sql)

Each model gets one or two new lines. Keeping them ordered near existing audit columns.

```diff
model IpdProgressNote {
  ...
  createdAt     DateTime @default(now())
  createdBy     String?
+ createdById   Int?
  ...
}

model IpdDischarge {
  ...
+ doctorSignature String?  // URL (GCS or static)
  hmisDischargeId String?
  createdAt       DateTime @default(now())
  createdBy       String?
+ createdById     Int?
  ...
}

model IpdPrescription {
  ...
+ modificationReason String?
  hmisRxId        String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  createdBy       String?
  updatedBy       String?
+ createdById     Int?
  ...
}

model IpdMedicationLog {
  ...
  createdAt       DateTime @default(now())
+ createdById     Int?
  ...
}

model MlcCase {
  ...
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  createdBy       String?
  updatedBy       String?
+ createdById     Int?
  ...
}

model LamaRecord {
  ...
  createdAt       DateTime @default(now())
  createdBy       String?
+ createdById     Int?
  ...
}

model DamaRecord {
  ...
  createdAt       DateTime @default(now())
  createdBy       String?
+ createdById     Int?
  ...
}
```

No back-relation added to `User` — `createdById` stays as a loose typed pointer, same shape as `IpdAdmission.referralOpdId`. This avoids touching the `User` model and the cascade/restrict decisions that would come with a `@relation`.

---

## Preview command (no shadow DB, per standing rule)

```
npx prisma migrate diff \
  --from-schema-datasource ./prisma/schema.prisma \
  --to-schema-datamodel ./prisma/schema.prisma \
  --script
```

Will be run after the schema patch is staged and before running `prisma migrate deploy`. Output is expected to match the `migration.sql` above byte-for-byte. If the preview shows anything beyond the 9 `ALTER TABLE ADD COLUMN` lines, **STOP** and investigate before applying.

---

## Data-preservation analysis

Per policy, the migration report must state how data preservation is proven for each added column. All three changes are **nullable additive** — MySQL 8.0+ uses the INSTANT algorithm for such operations, which:

- Does not rewrite existing rows.
- Does not acquire a table-wide metadata lock beyond the brief schema-update moment.
- Does not mutate any existing values.

Post-migration, every pre-existing row in each affected table will have:
- `createdById = NULL` (for the 7 MRD-audit additions)
- `IpdDischarge.doctorSignature = NULL`
- `IpdPrescription.modificationReason = NULL`

This matches the nullable default. Existing reads + writes that don't touch these columns continue to work unchanged. The Item 1 enforcement logic, landing in Phase 1b, will require the NEW columns on future writes — **existing historical rows remain valid** because enforcement is write-path, not read-path.

**Row counts expected to be preserved (to be verified in post-migration report):**
- `IpdProgressNote`, `IpdDischarge`, `IpdPrescription`, `IpdMedicationLog`, `MlcCase`, `LamaRecord`, `DamaRecord` — each table's row count identical before and after.
- `_prisma_migrations` — gains 1 row for the new migration.

---

## Apply procedure (if approved)

1. Stage the Prisma schema patches shown above.
2. Create `prisma/migrations/20260420130000_mrd_audit_and_signature_bundle/migration.sql` with the SQL above.
3. Run `prisma migrate diff` (preview command above); confirm byte-match against the `migration.sql`.
4. Run `prisma migrate deploy`.
5. Post-migration verification:
   - `SELECT COUNT(*) FROM IpdProgressNote;` etc. — 7 row-count checks, before/after parity.
   - `DESCRIBE IpdProgressNote;` — confirm `createdById` column present and nullable.
   - `SELECT COUNT(*) FROM _prisma_migrations;` — incremented by 1.
6. Report back with the verification results + the `prisma migrate deploy` output before starting Phase 1b.

---

## Open questions for user approval

### 1. Confirm Option A for MRD audit column

- **Option A (my recommendation):** `createdById Int?` on 7 clinical models (this plan).
- **Option B:** Skip schema change; enforcement is pure application-layer middleware operating on the existing `createdBy String?`.
- **Option C:** Single `auditContext String? @db.LongText` JSON column per clinical model — flexible, less queryable.

### 2. Scope question — do we also add `updatedById`?

`IpdPrescription`, `MlcCase`, and `IpdMedicationLog` (partially) have `updatedAt` timestamps. Should we also add `updatedById Int?` to these three to track who made each update? Adds 3 more `ALTER TABLE` lines to the migration. **My lean: skip this sprint** — create-time attribution is the NABH minimum; update tracking is a 4b add.

### 3. Confirm migration name + timestamp

Proposed name: `20260420130000_mrd_audit_and_signature_bundle`. Timestamp matches today (2026-04-20 at 13:00 local). Any objection to the name?

---

## What happens after this plan is approved

1. Agent stages schema patches.
2. Agent writes `migration.sql`.
3. Agent runs `prisma migrate diff` to preview.
4. Agent runs `prisma migrate deploy`.
5. Agent runs verification queries.
6. Agent reports back with apply output + row-count verification.
7. **STOP.** Wait for go on Phase 1b (MRD enforcement logic — Item 1 proper).

No application code changes in Phase 1a. Logic enforcement and the middleware wiring are Phase 1b.
