# Sprint 2f — LAMA / DAMA backend HMIS push wiring

Source rows: `docs/GAP_ANALYSIS.md` Module 3 (LAMA / DAMA).
Scope: wire create + update endpoints for both `LamaRecord` and `DamaRecord` through the Sprint-1 wrapper with **inline-await** (regulatory paperwork, low frequency, signed documentation). Additive migration for `hmisLamaId` + `hmisDamaId`. No frontend. No Figma.

Last Sprint 2 module before Sprint 2.5 (Figma theme tokens).

---

## Step 1 — Plan

### Endpoints in scope (8 total — 2 creates + 2 updates + 4 reads)

| Route | Handler | Type | HMIS push? |
|---|---|---|---|
| `POST /api/lama-dama/lama` | `createLamaRecord` | create | **Yes** (inline-await, persist `hmisLamaId`) |
| `POST /api/lama-dama/dama` | `createDamaRecord` | create | **Yes** (inline-await, persist `hmisDamaId`) |
| `PUT /api/lama-dama/lama/:id` | `updateLamaRecord` | update | **Yes** (inline-await, opportunistic `hmisLamaId` backfill) |
| `PUT /api/lama-dama/dama/:id` | `updateDamaRecord` | update | **Yes** (inline-await, opportunistic `hmisDamaId` backfill) |
| `GET /api/lama-dama/lama/:id` | `getLamaRecord` | read | No — contract test |
| `GET /api/lama-dama/dama/:id` | `getDamaRecord` | read | No — contract test |
| `GET /api/lama-dama/lama-list` | `getAllLamaRecords` | read | No — contract test |
| `GET /api/lama-dama/dama-list` | `getAllDamaRecords` | read | No — contract test |

Out of 2f scope (deferred to later sprints): signature uploads (4 POSTs), PDF downloads, stats / compliance-report, by-date/by-emergency filters, verify endpoint, `getLamaDamaRecords` unified list.

### Gap analysis findings

- Both `createLamaRecord` / `createDamaRecord` write a silent-stub `createHmisAuditLog({ status: 'success' })` without any real HMIS call. Same stub pattern we've fixed throughout Sprint 2.
- Both `updateLamaRecord` / `updateDamaRecord` have **NO audit log** AND no HMIS push — just the Prisma update.
- Both models have an `emergencyId @unique` FK so the "already exists for this emergency" guard is enforceable at the app layer (currently returns 400 — preserving existing status code per 2e precedent for duplicate-MLC; flag for Sprint 4 hardening to 409).
- Neither `LamaRecord` nor `DamaRecord` has an `hmisLamaId` / `hmisDamaId` column.
- Original plan mentioned `hmisPushed Boolean` on both models. With the Sprint-1 wrapper writing `HmisAuditLog` for every push, a separate boolean is redundant — the audit log IS the source-of-truth signal for "was this synced." Not adding `hmisPushed`. Deviation flagged.
- Strict-compliance check of `lama-dama.controller.ts`: 0 `(req as any)` / `(prisma as any)` / `@ts-ignore`. 6 pre-existing `: any` slots on local filter variables and array typings — out of 2f scope per policy, Sprint 4 cleanup pass.

### What I will CREATE

- **Schema** additive columns in one migration (single file, two `ALTER TABLE` statements — both are additive and related; atomic at deploy time):
  - `LamaRecord.hmisLamaId String?`
  - `DamaRecord.hmisDamaId String?`
- **Migration file** (hand-written per policy): `prisma/migrations/20260418140000_add_hmisid_to_lama_and_dama_records/migration.sql`
- **4 push methods in [hmis-client.ts](../../src/api/hmis-sync/hmis-client.ts)** — consistent with MLC's 2-method pattern per model × 2 models:
  - `pushLamaCase(data)` → `POST /lama/register` (initial create)
  - `pushLamaUpdate(data)` → `PUT /lama/:hmisLamaId` (field updates)
  - `pushDamaCase(data)` → `POST /dama/register`
  - `pushDamaUpdate(data)` → `PUT /dama/:hmisDamaId`
- **4 exported typed payload builders** in [lama-dama.controller.ts](../../src/api/lama-dama/lama-dama.controller.ts):
  - `buildLamaCreatePayload`, `buildLamaUpdatePayload`
  - `buildDamaCreatePayload`, `buildDamaUpdatePayload`
- **2 opportunistic-backfill helpers** (one per type; same pattern as MLC's `persistHmisMlcIdIfMissing`):
  - `persistHmisLamaIdIfMissing`
  - `persistHmisDamaIdIfMissing`
- **Test suite** `src/api/lama-dama/__tests__/lama-dama.test.ts`: 14 write tests + 4 read contracts = 18 total. Single file (under 25-split threshold).

### What I will PATCH

- `createLamaRecord`: replace silent-stub audit block with `syncWithHmis` wrapping `pushLamaCase`. Persist `hmisLamaId` on HMIS success via follow-up update.
- `createDamaRecord`: same pattern with `pushDamaCase` → `hmisDamaId`.
- `updateLamaRecord`: add `syncWithHmis` wrapping `pushLamaUpdate` after the Prisma update. Apply `persistHmisLamaIdIfMissing` backfill if still null.
- `updateDamaRecord`: same pattern with `pushDamaUpdate` → `persistHmisDamaIdIfMissing`.

### What I will NOT CHANGE

- Existing `Emergency.status = 'LAMA' | 'DAMA'` transition inside the create handlers — keep as-is.
- 400 vs 409 for duplicate-LAMA / duplicate-DAMA — preserve 400 (user explicitly approved that precedent in Sprint 2e).
- Signature upload handlers (4 POSTs) — out of scope; Sprint 4 hardening to wrap them in the audit pipeline.
- The 6 pre-existing `: any` local types in this controller — out of scope per user's file-scope policy (not in the direct blast radius of the 4 handlers I'm patching).
- Read handlers' behavior — contract tests lock current behavior without changing it.

### HMIS push contracts

| Handler | direction | module | entityType | action |
|---|---|---|---|---|
| `createLamaRecord` | push | `lama` | lama-record | `lama_created` |
| `createDamaRecord` | push | `dama` | dama-record | `dama_created` |
| `updateLamaRecord` | push | `lama` | lama-record | `lama_updated` |
| `updateDamaRecord` | push | `dama` | dama-record | `dama_updated` |

- `swallowErrors: true` (default) — HMIS failure must NOT block regulatory paperwork; the local row is already committed at push time.
- `maxRetries: 0` (default) — hmis-client retry (3× exponential) still active.

### Opportunistic backfill — applied

LAMA/DAMA aren't just create-only. Updates happen (witness signature added later, doctor advice refined). The `persistHmis{Lama,Dama}IdIfMissing` helpers let any successful update push backfill the `hmisLamaId`/`hmisDamaId` if the create-time push had failed. Same design as MLC's Sprint 2e pattern — approved by user.

### Schema decision & migration

**Add** `hmisLamaId String?` on `LamaRecord` and `hmisDamaId String?` on `DamaRecord`.

**One migration file, two `ALTER TABLE`s** (vs two separate folders):
- Both changes are additive nullable column adds.
- Both run atomically in a single `migrate deploy` step.
- Keeping them together prevents partial-apply: if for any reason the migration is aborted between statement 1 and statement 2, Prisma rolls back the whole file as a unit (MySQL DDL is auto-committed per statement so rollback is imperfect, but the migration-tracking row only flips to APPLIED after the whole file runs). Acceptable for nullable ADD COLUMNs — no data loss either way.
- Keeps migration history tidy — one sprint, one conceptual unit, one migration folder.

**Migration file:** `prisma/migrations/20260418140000_add_hmisid_to_lama_and_dama_records/migration.sql`
```sql
-- AlterTable
ALTER TABLE `LamaRecord` ADD COLUMN `hmisLamaId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `DamaRecord` ADD COLUMN `hmisDamaId` VARCHAR(191) NULL;
```

**Data-preservation verification (per policy):**
- Both statements are `ALTER TABLE … ADD COLUMN … NULL` — additive only.
- MySQL 8.0+ INSTANT algorithm: metadata-only, no row rewrite, no table lock.
- All existing `LamaRecord` / `DamaRecord` rows get `hmisLamaId = NULL` / `hmisDamaId = NULL`.
- No UPDATE, no DELETE, no DROP, no TRUNCATE.
- Preview: `prisma migrate diff --from-schema-datasource ./prisma/schema.prisma --to-schema-datamodel ./prisma/schema.prisma --script` (NO `--shadow-database-url`). Output matches the hand-written SQL.
- Apply: `prisma migrate deploy` (one statement inserts into `_prisma_migrations` after both DDLs run).

### Test plan (18 tests)

| Handler | Happy | HMIS failure | Sanity | Count |
|---|---|---|---|---|
| `createLamaRecord` | ✓ 201, persists hmisLamaId | ✓ 201, failure audit | missing `doctorAdvice` → 400; duplicate for emergency → 400 | 4 |
| `createDamaRecord` | ✓ | ✓ | missing `doctorRecommendation` → 400; duplicate for emergency → 400 | 4 |
| `updateLamaRecord` | ✓ 200 + backfill when null | ✓ 200, failure audit | prisma update throws → 500, no HMIS | 3 |
| `updateDamaRecord` | ✓ 200 + backfill when null | ✓ 200, failure audit | prisma update throws → 500, no HMIS | 3 |
| `getLamaRecord` | — | — | contract: includes emergency fields | 1 |
| `getDamaRecord` | — | — | contract: includes emergency fields | 1 |
| `getAllLamaRecords` | — | — | contract: ordered by createdAt desc | 1 |
| `getAllDamaRecords` | — | — | contract: ordered by createdAt desc | 1 |

**Audit JSON capture target:** `createLamaRecord` happy + failure for the sync-check doc (representative of the LAMA lifecycle kick-off).

### Hard-rule checks

- [ ] No new `any` / `@ts-ignore`
- [ ] Wrapper used for every HMIS push (no raw `pushLama*` / `pushDama*` outside wrapper)
- [ ] Audit on success AND failure (wrapper behavior)
- [ ] Schema change is additive only (nullable column adds, NOT defaults, NOT backfills)
- [ ] Migration data-preservation verified (INSTANT algorithm, no row rewrite)
- [ ] No `--shadow-database-url`
- [ ] `migrate diff --from-schema-datasource` preview matches migration file byte-for-byte
- [ ] Tests: ≥2 per write endpoint; 18 total (14 writes + 4 reads)
- [ ] Inline-await per Sprint 2 latency policy
- [ ] Persist `hmisLamaId` / `hmisDamaId` from HMIS response on success
- [ ] Opportunistic backfill pattern applied on updates
- [ ] Test isolation: mocks only; `jest-setup.ts` DATABASE_URL stomp still active

---

# Sprint 3e — LAMA / DAMA Completion (frontend)

Phase 0 audit (see [lama-dama-frontend-audit.md](lama-dama-frontend-audit.md)) found the existing `/lama-dama` list component ~55% built — stats, tab nav, tables, verify + download actions. No register, no detail, no HMIS sync surface. Architecture decision approved: **combined screens with sub-routes**. New reusable `HmisSyncIndicator` (P6) extracted for two-plus use cases.

## Step 1 — Plan

### Architecture

```
/lama-dama                          (enhanced — existing list)
/lama-dama/new?type=<lama|dama>     (combined register form, type-discriminated)
/lama-dama/:type/:id                (combined detail view)
```

Single service (`LamaDamaService`) serves all three screens. Interface extension adds `hmisLamaId` / `hmisDamaId` fields — otherwise the existing service API is unchanged.

### Combined Register form — shared vs type-specific

Comparing the two schemas side-by-side:

| Shared | LamaRecord-only | DamaRecord-only |
|---|---|---|
| emergencyId | `doctorAdvice` (required, LongText) | `doctorRecommendation` (required, LongText) |
| timestamp (lamaTime / dischargeTime — same purpose, different column name) | `riskExplained` (bool required) | `patientDeclinesAdvice` (bool required) |
| witnessName | `reasonForLama` (required, Text) | `followUpAdvice` (optional, LongText) |
| witnessSignature (URL) | | |
| patientSignature (URL) | | |

Form structure: shared section first (5 fields) + type-specific section that swaps in `*ngIf` based on `type` discriminator. The three type-specific field patterns are structurally similar (long-text advice / acknowledgement boolean / context text) but with different copy + different required-ness of the third field (LAMA.reasonForLama required vs DAMA.followUpAdvice optional).

### HmisSyncIndicator — extracted as P6

First feature-local implementation lived in MLC Detail (Sprint 3d). Extracted to `shared/ui/hmis-sync-indicator/` in 3e for three call sites (LAMA Detail, DAMA Detail — same component with route param — and list-row badges). Props:

```ts
@Input() hmisId: string | null;
@Input() prefix: string = 'HMIS';
@Input() size: 'default' | 'small' = 'default';
```

`size` added this sprint — list-row column is narrow, detail-view indicator sits next to a section title. Copy identical between sizes; typography shrinks for `'small'`. Documented in `ui-patterns.md § P6`.

MLC Detail's inline sync indicator **stays** until Sprint 3.5 (user-approved deferral). Backlog entry updated in `docs/sprint-3-backlog.md`.

### Detail view — read-only + edit flow

Detail screen renders the full record as read-only, with a single **Edit** button that reveals text-field inputs inline. Save calls `updateLamaRecord` / `updateDamaRecord`. Reason for the edit flow (beyond just display):

- Opportunistic-backfill is the reason Sprint 2f built the update endpoints. The test for that flow needs an update action the user can trigger.
- Real clinical edits happen too (witness signature URL arrives later, follow-up advice refined).

File uploads for signatures (backend endpoints exist) are **not** in v1 — same scope boundary as MLC 3d. Flagged.

### Patterns composed

| UI element | Pattern | Notes |
|---|---|---|
| Page header w/ patient context | P2 | emergency.prn → PatientDetails |
| Register form | §1 FORM | shared + type-specific sections |
| Type discriminator | dropdown | `lama` / `dama` |
| Destructive create confirm | §3 MODAL-3a danger — P1 | "Recording [LAMA \| DAMA] updates Emergency status and cannot be reversed from this screen" |
| Detail summary | §7 CARD read-only | all fields displayed |
| Detail edit | §1 FORM inline | single Save/Cancel |
| **HMIS sync indicator** | §P6 | reusable — default in Detail, size="small" in list rows |
| List empty state | P4 | replaces legacy "No LAMA records." div |
| Toasts | §6 | verify→toast (replaces `alert()`) |

### Patient context

`emergency.prn → AppointmentConfirmService.getDetailsByPRN(prn)` → `<app-page-header>`. Same going-forward rule as 3c/3d.

### Inline-await UX contract

- Register submit shows spinner during HMIS round-trip; response's `data.hmisLamaId` / `data.hmisDamaId` may or may not be populated.
- Detail view surfaces sync status via `<app-hmis-sync-indicator>`.
- Edit submit → reload detail → indicator flips pending→synced if the update backfilled the HMIS id.

### Gaps invoked

No new gaps — all tokens ratified; sync-indicator extraction is within approved P6 boundaries. Three inherited unresolved flags:
- File-upload UI (signatures) scoped out same as MLC 3d.
- PatientDetails-based signature capture (vs. text URL) deferred.
- Close-case flow parity with MLC's "reversible via backend edit" language — carried forward.

### Tests (total ~27)

- **HmisSyncIndicator**: 4 (synced / pending / prefix / size)
- **Service**: ~8 (create LAMA happy + 4xx + 5xx, create DAMA happy + 4xx + 5xx, update happy for both, get 404)
- **Register**: ~6 (render empty, pre-fill from emergencyId, type switch reveals right fields, validation, confirm-then-submit, error preserves form)
- **Detail**: ~5 (renders summary, sync pending, sync synced, edit→update with opportunistic backfill, error toast preserves form)
- **List enhancement**: ~4 (Create LAMA button, Create DAMA button, row→detail nav, sync badge per row)

### Hard-rule checks

- [ ] Zero hardcoded hex in new CSS (Register + Detail + sprint-3e additions to list)
- [ ] Zero new `any` / `@ts-ignore`
- [ ] Tokens via `var(--…)`
- [ ] P1 ConfirmDialog(severity=danger) gates both LAMA and DAMA creates
- [ ] P2 PageHeader on Register + Detail
- [ ] P4 EmptyState on list (replace inline div)
- [ ] P6 HmisSyncIndicator on Detail + list-row badge
- [ ] Patient context via `prn → PatientDetails`
- [ ] Inline-await UX: sync indicator reflects backend id, flips on opportunistic backfill
- [ ] Backlog updated with MLC migration line for Sprint 3.5
- [ ] Full test counts reported before/after
