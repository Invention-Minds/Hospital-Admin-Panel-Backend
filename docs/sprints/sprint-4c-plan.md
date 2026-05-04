# Sprint 4c — Legacy Cleanup · Planning Stub

**Date:** 2026-04-21 · **Status:** Planning stub. Not committed. 4c work begins after 4b completes; detailed plan written at 4c kickoff.

Scope captured as it accumulates during 4b execution. Items here are
behaviour-preserving refactors and legacy-data cleanups — none block
production readiness.

---

## 1. Prisma client consolidation — Cluster C (33 files)

**Trigger:** 4b.6 Step 0 audit found 40 rogue `new PrismaClient()` instantiations
across 39 files (vs the "~2-5" pre-audit estimate). 4b.6 executed Clusters A+B
(7 files: the 4 Sprint-3f-flagged controllers + 3 shared-infra files). Cluster
C — the remaining 33 legacy files — deferred here.

**Files:**

| Area | Files | Instances |
|---|---|---|
| `ad`, `channel`, `callback` | 3 | 3 |
| `appointments` (controller/repo/resolver) | 3 | 3 |
| `doctor` (controller/repo/resolver; **repo has 2 instances**) | 3 | 4 |
| `doctor-notes`, `history-notes` | 2 | 2 |
| `extraslots`, `mhc-checkin`, `radiology-queue` | 3 | 3 |
| `department` (controller/resolver/respository) | 3 | 3 |
| `estimation.controller` | 1 | 1 |
| `er.controller` | 1 | 1 |
| `login` (controller/repo/resolver) | 3 | 3 |
| `whatsapp.controller` | 1 | 1 |
| `therapy.controller` | 1 | 1 |
| `patient` (controller/repo/helper) | 3 | 3 |
| `services` (controller/repo/scheduler) | 3 | 3 |
| `service-radiology` (controller/repo) | 2 | 2 |
| **Cluster C total** | **33 files** | **33 instances** |

**Scope:**

- Behaviour-preserving refactor. All 33 instances use default `new PrismaClient()` with zero args — no log-level, datasource, or extension configuration to preserve (confirmed by 4b.6 audit 0.3).
- Pattern per file: replace `const prisma = new PrismaClient()` (or `private prisma = new PrismaClient()` in class fields) with import from `src/service/prisma-client`. For repository/resolver classes, use `private readonly prisma = sharedPrisma` to preserve the `this.prisma.xxx` call-site shape.
- `doctor.repository.ts` has **both** a module-scope AND a class-field `new PrismaClient()` — both go.
- `services.controller.ts:182` and `service-radiology.controller.ts:254` both have local `$transaction` call sites that currently commit against rogue pools. Post-consolidation they'll commit against the shared singleton pool — identical semantics, but worth smoke-testing the service-save flow after conversion.

**Test impact:**

- Test coverage for Cluster C files is sparse. No test file mocks `@prisma/client` specifically for these files (per 4b.6 audit 0.4 grep results).
- Verification primarily via `tsc --noEmit` and integration-style smoke tests. Consider adding direct unit tests for any Cluster C file with non-trivial business logic that the refactor touches (especially the two tx sites).

**Risk class:** low. Behaviour-preserving; no migration; no identity changes. Largest risk is a typo in an import path that tsc catches immediately.

**Estimated scope:** medium. ~80+ line edits across 33 files + any repository/resolver constructor adjustments. Schedule when time permits; not blocking production readiness.

---

## 2. Legacy follow-up row audit (carried over from sprint-4b-plan.md)

**Trigger:** if production DB lands with real follow-up rows created before 4a Phase 1c's FK-bug fix.

**Scope:**
- Identify `Appointment` rows where `isfollowup = true` AND `patientId IS NOT NULL` AND `patientId` does not resolve to a valid `Patient.id` (orphaned from the pre-Phase-1c `patient.id = PatientDetails.id` bug).
- Also identify rows where `patientId` resolves but links to a **different patient** (wrong-patient bug — harder to detect; cross-check `patientName` vs. the resolved `Patient.name`).
- **Remediation:** for each bad row, either (a) correct by setting `patientId = null` + populating `prnNumber` from the `patientName` lookup, or (b) quarantine with a `status = 'voided-data-integrity'` sentinel when reconciliation is ambiguous.

**Dev DB status at Phase 1c kickoff:** **zero** legacy follow-up rows. Clean slate. This backlog entry exists only as a safeguard for production rollout.

Scope will be determined by the row count at production rollout time.

---

## Not yet committed (revisit at 4c kickoff)

- Anything flagged during 4b.2–4b.5 execution that the per-phase reports defer here.
- Sprint 3f backlog's residual cosmetic / debt items.
