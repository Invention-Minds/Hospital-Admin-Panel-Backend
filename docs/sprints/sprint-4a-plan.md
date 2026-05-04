# Sprint 4a — NABH Audit-Readiness Mini-Sprint · Plan (v2, approved)

**Date:** 2026-04-20 · **Status:** SHIPPED. 5 of 5 executed phases (1a–1e) approved. **Item 2 (Discharge PDF) is PARKED / DEFERRED INDEFINITELY** — explicitly removed from the 4b/4c queue per 2026-04-20 decision. Will be reopened only via a future sprint directive; no standing clock.

> **⚠ Planning note:** The sections below describing "Phase 2 — gated on hospital template" and the hospital-template request clock (D2) are RETAINED FOR HISTORY but **no longer represent active scope**. The agent will not treat any D2 / Phase 2 / Item 4 text as near-term work until explicit re-open.

**Supersedes:** v1 of this doc (original planning — retained in git history).

---

## Item list — 7 items, ~11 scope units

| # | Item | Scope | Phase | Blockers |
|---|---|---|---|---|
| 1 | MRD audit (creator + timestamp enforcement) | **3 large** | Phase 1 | Depends on migration bundle |
| 2 | `IpdDischarge.doctorSignature` schema field | **1 small** | Phase 1 (migration bundle) | None |
| 3 | `modificationReason` column on `IpdPrescription` | **1 small** | Phase 1 (migration bundle) | None |
| 4 | ~~Discharge summary PDF generation~~ | — | **PARKED (deferred indefinitely 2026-04-20)** | Will reopen only via explicit future-sprint directive |
| 5 | Follow-up appointment auto-creation | **2 medium** | Phase 1 | Depends on Item 1's stricter createdBy rule |
| 6 | Bed census daily (hybrid snapshot + on-demand) | **1 small** | Phase 1 | None (has own additive migration for `BedCensusSnapshot` table) |
| 7 | Server-side ack wiring for critical-values dismiss | **1 small** | Phase 1 | None |

Total: **7 items, ~11 scope units.**

---

## Decisions resolved (D1–D4)

### D1 — Moves
- **Retry cron** → 4b. Failed HMIS pushes are audit-logged; auto-reconciliation is correctness, not audit evidence.
- **Ack wiring** → **kept in 4a** (was proposed OUT). NABH MRD audit trail requires "who acknowledged critical clinical events". Today the widget dismisses locally and the server has no record. Same MRD.1 class as Item 1. 1 unit.
- **`doctorSignature` + `modificationReason`** → both moved **IN** to 4a; bundled into the Phase 1a migration.

### D2 — Discharge PDF template clock ~~(superseded)~~
**2026-04-20 decision: Item 4 parked indefinitely.** No hospital-template clock is running. The scaffold at `src/api/ipd/discharge-pdf-generator.ts` and the existing `downloadDischargePDF` endpoint remain in the codebase unchanged. The requirements list below is retained as reference for the eventual re-open, but is not currently actionable.

<details>
<summary>Historical requirement list (not active)</summary>

- Letterhead image (PNG/PDF of current use)
- Signature block layout (doctor name, designation, registration number, signature placement)
- Section order (diagnosis / medications / advice / follow-up — which first?)
- Mandatory fields NABH assessors have flagged previously
- Footer content (address, reg number, contact)
- Bilingual or English only
- Agent will not invent letterhead, signature layout, or section order.

</details>

### D3 — Bed census delivery mode
- **Hybrid:** daily cron snapshot + on-demand live view.
- Cron at midnight writes to a new `BedCensusSnapshot` table (additive migration).
- Admin dashboard: "View today's census" (live data) + historical date picker (snapshot data).
- **No email delivery in this sprint.** Email would pair with WhatsApp/SMS infrastructure in 4b if the hospital requests.

Schema for `BedCensusSnapshot` (user-proposed; confirm at migration time):
```prisma
model BedCensusSnapshot {
  id               Int      @id @default(autoincrement())
  snapshotDate     DateTime @unique
  snapshotTime     String
  wardId           String
  wardName         String   // denormalized for historical accuracy
  totalBeds        Int
  occupiedBeds     Int
  availableBeds    Int
  maintenanceBeds  Int
  byRoomType       String   @db.LongText  // JSON: { general, "semi-private", private, ICU, HDU }
  snapshotReason   String   // 'cron' | 'manual' | 'recovery'
  createdAt        DateTime @default(now())

  @@index([wardId])
  @@index([snapshotDate])
}
```

Note: `snapshotDate @unique` conflicts with per-ward rows (if each ward has a row, unique must be composite). **Flagged for confirmation at migration-plan time** — likely `@@unique([snapshotDate, wardId])` instead.

### D4 — Count preference
- Strict **19 unique** is canonical.
- 4b and 4c scope will be re-segmented off the strict list **after 4a ships**.
- Backlog file deduped today (Phase 0, before starting Phase 1a).

---

## Execution order

### Phase 0 — Backlog hygiene (this session, pre-migration)
- **Dedupe [sprint-3-backlog.md](../sprint-3-backlog.md)** — remove the 4 overlaps between "Other open flags" and "Sprint 4 additions from 3f":
  - CSS selector syntax audit (`:deep(...)` item)
  - OPD diagnosis parameter
  - Three-level modal a11y
  - `<select>` `[disabled]` reactive-forms warning

### Phase 1 — can start now, no external blockers

**1a. Migration bundle** (this doc's next output):
- MRD audit column(s) — shape TBD in migration plan (see open question §1 below)
- `doctorSignature String?` on `IpdDischarge`
- `modificationReason String?` on `IpdPrescription`
- Single hand-written `migration.sql`, no shadow DB, all nullable.

**1b. Item 1 — MRD audit enforcement logic** — depends on 1a.
- Controller middleware to require + populate creator/timestamp on clinical writes.
- Coverage audit across IPD, MLC, LAMA, DAMA, Prescription, OPDAssessment, InvestigationOrder write paths.
- 8–12 tests.

**1c. Item 5 — Follow-up auto-creation (FIX + WIRE)** — depends on 1b.
- Fix [follow-up-automation.ts:138](../../src/api/ipd/follow-up-automation.ts) PatientDetails/Patient FK confusion.
- Wire `createDischarge` controller to invoke the automation.
- Validate default rules with clinical lead (light ask, non-blocking).
- 4–6 tests.

**1d. Item 7 — Server-side ack wiring** — standalone.
- Update `CriticalValuesAlertComponent.clearAlert(id)` to call `CriticalValuesService.acknowledgeAlert(alertId, acknowledgedBy)` via the already-tested HTTP path.
- Add loading state on the dismiss button.
- Graceful fallback: if server ack fails, remove locally anyway + toast the failure ("Alert dismissed locally — server couldn't be reached").
- 3–4 tests.

**1e. Item 6 — Bed census daily (hybrid)** — standalone (has own additive migration for `BedCensusSnapshot`).
- New migration: `BedCensusSnapshot` table.
- Cron at midnight: query current state → write N rows (one per ward).
- Live endpoint: existing `getBedCensus` already returns current state.
- Historical endpoint: new `GET /ward/bed-census-snapshots?date=YYYY-MM-DD`.
- 4–6 tests.

### ~~Phase 2 — gated on hospital template~~ (PARKED)

**2026-04-20 decision: Item 4 is deferred indefinitely.** No dependency on 4b/4c. The existing `discharge-pdf-generator.ts` scaffold and `downloadDischargePDF` endpoint remain in place, untouched. No clock; no template requested; no planning work in 4b. Re-open requires an explicit future-sprint directive.

---

## Test targets (per user spec)

| Item | Test count |
|---|---|
| 1 — MRD audit enforcement | 8–12 |
| Schema bundle (1a) | 0 (additive, no logic) |
| Schema bundle for BedCensusSnapshot | 0 (additive) |
| 5 — Follow-up auto-creation | 4–6 |
| 7 — Server-side ack wiring | 3–4 |
| 6 — Bed census cron + snapshot + view | 4–6 |
| ~~4 — Discharge PDF (Phase 2)~~ | PARKED indefinitely (2026-04-20) |

**Phase 1 target: ~19–28 new tests.**

---

## Per-item review gate

Per user instruction: **report in standard format after EACH item, not batched.** Wait for approval before starting the next item. This is the longest sprint so far; the per-item gate catches issues early.

Flow per item:
1. Plan doc per the Sprint 3 per-module pattern (short, scoped to the item).
2. STOP — wait for plan approval.
3. Execute: migration (if any) → code → tests.
4. Run isolated subset + full suites.
5. Sync doc (if relevant) + per-item REPORT.
6. STOP — wait for next-item go.

---

## Open question for migration plan

### 1. What does the MRD audit migration actually add?

The user specified "three additive schema changes" in the Phase 1a bundle, all nullable. Two are clear:
- `IpdDischarge.doctorSignature: String?`
- `IpdPrescription.modificationReason: String?`

The third is "MRD audit columns" — **shape needs confirmation**. Three options:

**Option A (my recommendation):** Add `createdById: Int?` as a typed FK to staff/User across 7 clinical models (`IpdProgressNote`, `IpdDischarge`, `IpdPrescription`, `IpdMedicationLog`, `MlcCase`, `LamaRecord`, `DamaRecord`). Rationale:
- Existing `createdBy: String?` stores usernames — ambiguous + unindexed for audit queries.
- Typed FK gives NABH-grade answer to "who created this" when the question is auditor-driven.
- Enforcement logic (Item 1) requires BOTH the new `createdById` populated AND `createdAt` populated on new writes.
- Existing `createdBy: String?` kept for backward-compat (not deprecated this sprint).

**Option B:** No new column; enforcement is purely application-layer (middleware requires `createdBy` on write, even though DB allows null). Schema unchanged for MRD. Bundle reduces to 2 additive changes (signature + modificationReason).

**Option C:** Add `auditContext: String? @db.LongText` JSON column on clinical models — captures creator + timestamp + IP + role + any future audit fields without schema churn. More flexible but less queryable.

**Default to A** unless user says otherwise. State your pick in the Phase 1a migration plan approval.

### 2. `BedCensusSnapshot` unique constraint

User's proposed shape has `snapshotDate DateTime @unique`. If each ward gets its own row (which seems natural given the `wardId` column), this conflicts. Propose `@@unique([snapshotDate, wardId])` instead. Flagged for migration-plan confirmation.

---

## Hard rules (reaffirmed)

- Hand-written migration.sql for every schema change.
- No `--shadow-database-url` (per standing rule).
- Nullable additive columns only; no constraint changes, no data mutation.
- Prove data preservation in the migration report for each added column.
- Patient lookup via `prn → PatientDetails` (going-forward rule).
- Zero new `any` / `@ts-ignore`.
- Compile-blockers in scope, broken stubs not.
- **Per-item review gate — do not batch reports.**

---

## Next step

Agent writes the **Phase 1a migration bundle plan** as the next output. That plan:
- Proposes the exact migration.sql content (MRD audit column(s) + doctorSignature + modificationReason).
- States the MRD option chosen (A / B / C) with rationale.
- Lists affected Prisma models.
- States the data-preservation analysis (all nullable, INSTANT algorithm applicable on MySQL 8, zero row rewrite).
- Includes the `prisma migrate diff` command used to preview (no shadow DB).

**STOP** after plan output. Wait for user approval of the migration before running `prisma migrate deploy`.
