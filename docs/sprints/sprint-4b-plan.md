# Sprint 4b — Planning Stub (scope captured during 4a)

**Date:** 2026-04-20 · **Status:** Planning stub. Not committed. 4b work begins after 4a completes; detailed plan written at 4b kickoff.

This file captures scope items that surfaced during 4a execution while the context was fresh. Finalize 4b/4c segmentation after 4a ships (per the original 4a plan's D4 decision).

---

## Committed 4b scope

### 1. Update attribution — full pass (MRD.1 completion)

**Trigger:** 4a Phase 1b explicitly deferred update-time actor attribution on 5 of 7 clinical models where the `updatedBy String?` column is absent. 4a enforced `requireClinicalActor` + added `updatedAt DateTime? @updatedAt` via Phase 1a gap-fill migration, so updates prove "an authenticated user did this at this timestamp" — but cannot identify the user by name or typed id on the record row itself for those 5 models.

**Scope:**

- **Migration** (additive, single file, hand-written, no shadow DB):
  - `updatedBy VARCHAR(191) NULL` on 5 models: `IpdProgressNote`, `IpdDischarge`, `IpdMedicationLog`, `LamaRecord`, `DamaRecord`.
  - `updatedById INT NULL` on all 7 clinical models: the 5 above + `IpdPrescription`, `MlcCase`.
  - Total: 12 `ALTER TABLE ADD COLUMN` statements.
  - All nullable. Existing rows stay NULL until first update.

- **Controller patches** (16 update handlers):
  - Stamp both `updatedBy: req.user!.username` and `updatedById: actorId` on every update path.
  - Handlers already using `req.user?.username || 'system'` for `updatedBy` on 2 models (`IpdPrescription`, `MlcCase`) simplify to the non-null form matching Phase 1b convention.
  - Handlers currently not stamping `updatedBy` (5 models × their update handlers) start stamping.

- **Tests:** ~20 tests (1–2 per update handler asserting the new stamping on happy path; the rejection path is already covered by Phase 1b).

- **Estimated total:** medium — 1 migration + 16 handler touches + ~20 tests.

### 2. Other 4b items (deferred from 4a per original plan)

From the original 4a plan §D1:
- **Retry cron implementation.** `src/api/hmis-sync/hmis-sync.queue.ts` line ~374 still has the "retry cron is stubbed — see Sprint 4" comment. The failure-audit rows exist; re-dispatch is the gap. Medium scope.

From Sprint 3 backlog:
- **Prisma client consolidation** (emergency / opd / lama-dama / mlc controllers newing their own `PrismaClient`). ~4–8 files. Medium.
- Cosmetic / debt items to re-segment across 4b vs 4c after 4a ships.

---

## Not yet committed (revisit at 4b kickoff)

- SSE exponential backoff on `critical-values.service.ts`.
- CSS `:deep(...)` audit across the frontend.
- 129 CLI-scaffold broken frontend specs.

---

## Sprint 4b — Additions from Phase 1d (2026-04-20)

### 1. API-wide server-derived-identity audit

**Trigger:** Phase 1d found the critical-values ack endpoint reading `acknowledgedBy` from the request body with no JWT verification — a client-supplied-identity loophole in a NABH-critical write path. Same class as the IPD-no-auth gap closed in Phase 1b.

**Scope:**
- Grep every write endpoint (POST/PUT/PATCH) across `src/api/*` for handlers that derive identity from `req.body.*` or request headers rather than `req.user` (populated by `authenticateToken`).
- For each hit: apply `authenticateToken` middleware; replace body/header attribution with `req.user!.username` / `req.user!.id`; drop the body field from the contract (ignore if client still sends it).
- Write tests proving body-supplied identity is ignored (same pattern as Phase 1d's `critical-values-ack.test.ts`).

**Risk class:** audit-trail impersonation. Any endpoint on this list could currently let a client self-attribute to any username. Rewriting to server-derived identity closes this systematically.

### 2. Critical-values ack persistent store

**Trigger:** Phase 1d audit noted the `alertAcknowledgments: Map<alertId, {acknowledgedBy, acknowledgedAt}>` in-memory store at [critical-value-sse.ts:24](../../src/api/hmis-sync/critical-value-sse.ts). Lost on every server restart. Not acceptable for NABH audit completeness.

**Scope (additive migration):**
```prisma
model CriticalValueAcknowledgment {
  id                    Int      @id @default(autoincrement())
  alertId               String   @unique
  acknowledgedBy        String
  acknowledgedById      Int?     // loose FK pointer to User.id (same pattern as Phase 1a)
  acknowledgedAt        DateTime @default(now())
  originalAlertPayload  String   @db.LongText  // JSON snapshot in case the alert rolls out of the 500-row in-memory buffer
  createdAt             DateTime @default(now())

  @@index([acknowledgedAt])
  @@index([acknowledgedById])
}
```
Plus `acknowledgeAlertById` becomes async, writes to DB in addition to (or instead of) the in-memory Map. Existing Map can be demoted to a read-cache.

---

## Sprint 4c — Legacy data cleanup (queued)

**Trigger:** if production DB lands with real follow-up rows created before 4a Phase 1c.

**Scope:**
- **Legacy follow-up row audit.** Identify `Appointment` rows where `isfollowup = true` AND `patientId IS NOT NULL` AND `patientId` does not resolve to a valid `Patient.id` (orphaned from the pre-Phase-1c `patient.id = PatientDetails.id` bug). Also identify rows where `patientId` resolves but links to a **different patient** (wrong-patient bug — harder to detect; cross-check `patientName` vs. the resolved `Patient.name`).
- **Remediation:** for each bad row, either (a) correct by setting `patientId = null` + populating `prnNumber` from the `patientName` lookup, or (b) quarantine with a `status = 'voided-data-integrity'` sentinel when reconciliation is ambiguous.
- **Dev DB status at Phase 1c kickoff:** **zero** legacy follow-up rows. Clean slate. This backlog entry exists only as a safeguard for production rollout.

Scope will be determined by the row count at production rollout time.

---

## Why this doc exists now

Per 4a Phase 1b review: "Log this in docs/sprints/sprint-4b-plan.md so the scope is captured while the context is fresh." Preserving the exact shape of update-attribution scope prevents another audit cycle at 4b kickoff.
