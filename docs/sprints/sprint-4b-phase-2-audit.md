# Sprint 4b · Phase 4b.2 — API-wide Server-Identity Audit · Step 0

**Date:** 2026-04-21 · **Status:** Audit complete — **awaiting scope + remediation approval before execution.**

**Trigger:** Phase 1b closed IPD zero-auth. Phase 1d closed critical-values-ack impersonation. Phase 4b.1 closed LAMA/DAMA/MLC body-spread leak via `stripAuditFields`. This phase sweeps the remaining write surface for the same pattern.

---

## 0.1 Grep methodology

Patterns scanned across all 35 `*.routes.ts` files and their corresponding controllers:

1. **POST / PUT / PATCH route definitions** — collect method + path + middleware chain + handler.
2. **Identity reads from body:** `req.body.createdBy`, `req.body.createdById`, `req.body.updatedBy`, `req.body.updatedById`, `req.body.acknowledgedBy`, `req.body.acknowledgedById`, `req.body.userId` (when used as attribution), `req.body.actorId`, `req.body.user`, `req.body.username`, `req.body.doctorId` (when used as attribution).
3. **Body-spread patterns:** `data: { ...req.body }`, `data: body` (where `body` is `req.body`-derived), `data: { ...payload }` where payload is body-derived. Flag `stripAuditFields` import/use presence.
4. **Identity-from-headers:** `req.headers['x-user-id']`, `req.headers['x-username']`, etc.
5. **Webhook-style paths:** `/webhook`, `/payment-confirmed`, `/*-ready`, `/:apiKey/:whatsappNumber`, public contact forms.

Grep was delegated to a scan agent and results cross-verified by spot-reading each flagged line to distinguish **attribution** (who did this) from **FK pointer** (which user this record is about — legitimate body input).

---

## 0.2 Endpoint inventory — risk-classified

### CRITICAL — identity writable from body on clinical/audit-relevant models (5 files, 8 call sites)

| # | Model | File / line | Pattern | Method | Auth today |
|---|---|---|---|---|---|
| C1 | DoctorNote (has createdBy + updatedBy) | [doctor-notes.controller.ts:10](../../src/api/doctor-notes/doctor-notes.controller.ts#L10) | `data: req.body` in `create` | POST / | **none** |
| C2 | DoctorNote | [doctor-notes.controller.ts:83](../../src/api/doctor-notes/doctor-notes.controller.ts#L83) | `data: {...payload}` where `payload = req.body` in `update` | PUT /:prn | **none** |
| C3 | HistoryNotes (has createdBy + updatedBy) | [history-notes.controller.ts:10](../../src/api/history-notes/history-notes.controller.ts#L10) | `data: req.body` in `create` | POST / | **none** |
| C4 | HistoryNotes | [history-notes.controller.ts:83](../../src/api/history-notes/history-notes.controller.ts#L83) | `data: {...payload}` in `update` | PUT /:prn | **none** |
| C5 | ERAssessment (has createdBy:Int) | [er.controller.ts:11](../../src/api/er/er.controller.ts#L11) | `data: req.body` in `create` | POST / | **none** |
| C6 | ERAssessment | [er.controller.ts:40](../../src/api/er/er.controller.ts#L40) | `data: req.body` in `update` | PUT /:id | **none** |
| C7 | OPDAssessment (has createdBy:Int) | [opd.controller.ts:71](../../src/api/opd/opd.controller.ts#L71) | `data: req.body` in `update` | PUT /:id | **none** |
| C8 | TabletMaster (has createdBy:String) | [prescription.controller.ts:108](../../src/api/prescription/prescription.controller.ts#L108) | `createdBy: req.body.doctorId` — direct client attribution | POST /tablets | **none** |

**Observation:** `OPDAssessment.create` at `opd.controller.ts:5-40` is field-by-field-mapped (safe). The leak is update-side only. `createdBy` is `Int` on ERAssessment/OPDAssessment; Prisma will reject string values, which limits the leak to numeric impersonation (attacker passes `createdBy: 999`).

### HIGH — attribution read from body for non-clinical audit-relevant models (5 files, 7 call sites)

| # | Model/column | File / line | Current pattern | Method |
|---|---|---|---|---|
| H1 | Appointment.userId | [appointment.controller.ts:177](../../src/api/appointments/appointment.controller.ts#L177) | `const userId = req.body.userId \|\| null` in `createAppointment`, passed into Prisma create | POST / |
| H2 | Appointment.userId | [appointment.controller.ts:429](../../src/api/appointments/appointment.controller.ts#L429) | Same pattern in `updateAppointment`; spread into `updateData` | PUT /:id (has authenticateToken) |
| H3 | Appointment.lockedBy | [appointment.controller.ts:591](../../src/api/appointments/appointment.controller.ts#L591) | `const userId = req.body.userId` in `lockAppointment`, stored as `lockedBy` | PUT /:id/lock (has authenticateToken) |
| H4 | EstimationDetails.lockedBy | [estimation.controller.ts:2238](../../src/api/estimation/estimation.controller.ts#L2238) | `const userId = Number(req.body.userId)` in `lockService` | PUT /:id/lock (**no auth**) |
| H5 | Service.lockedBy | [services.controller.ts:687](../../src/api/services/services.controller.ts#L687) | Same pattern | PUT /:id/lock (**no auth**) |
| H6 | RadiologyService.lockedBy | [service-radiology.controller.ts:428](../../src/api/service-radiology/service-radiology.controller.ts#L428) | Same pattern | PUT /:id/lock (**no auth**) |
| H7 | TherapyAppointment.lockedBy | [therapy.controller.ts:1305](../../src/api/therapy/therapy.controller.ts#L1305) | `const userId = Number(req.body.userId)` in `lockTherapyAppointment` | PATCH /lock/:id (**no auth**) |

**Observation:** H2 and H3 already have `authenticateToken` middleware — they just read the wrong source (body instead of `req.user`). These are 1-line fixes. H4–H7 are lock-handler patterns repeated across 4 controllers; identical shape, identical fix.

### MEDIUM — body-spread pattern, columns absent today (1 file, 1 call site)

| # | Model | File / line | Current state |
|---|---|---|---|
| M1 | PatientDetails (**no audit columns**) | [patient.controller.ts:213](../../src/api/patient/patient.controller.ts#L213) | `data: { ...patientData }` where `patientData = req.body` in create |

**Why MEDIUM not CRITICAL:** `PatientDetails` has no `createdBy`/`updatedBy`/`createdById` columns in the schema today (confirmed by reading schema.prisma L241–278). The body-spread cannot leak attribution today because there's nowhere for the bad data to land. **Becomes a CRITICAL the moment audit columns are added.** Preventive fix: apply `stripAuditFields` prophylactically so the future column addition doesn't re-open the loophole.

### LOW — missing `authenticateToken` on endpoints with no identity write (aggregate)

Many POST/PUT/PATCH endpoints lack `authenticateToken` but do not write identity attribution. Impersonation-adjacent (anyone can call the endpoint) but not an MRD.1 audit-trail bug. Includes routes across:

- `ad/*`, `channel/*`, `mhc-checkin/*`, `radiology-queue/*`, `upload/*`, `sms/*`, `email/*`, `voiceOPD/*`, `screenshot/*`, `whatsapp/*` (all bulk/cron-adjacent dispatch endpoints)
- `investigation/*` (3 POSTs)
- Several `callback`, `ward-management`, `doctor` (signature upload, mark-complete), `services`, `service-radiology`, `therapy` non-lock endpoints
- `critical-values/broadcast` — **testing endpoint, currently unauthenticated; should probably be locked or removed**

Count ≈ **50+ endpoints**. This is a Cluster-C-era "auth never got applied" backlog, not a Phase-1d-style impersonation class. Requires frontend-coordination to verify every path actually sends JWT before hardening (otherwise prod clients break). **Deferred recommendation: Sprint 4c alongside Prisma-Cluster-C cleanup.**

### NONE — clean endpoints (already server-derived, req.user-based)

| Module | Status |
|---|---|
| IPD (ipd.routes, ipd-prescription.routes, ward-management snapshot) | ✓ `authenticateToken` + `requireClinicalActor` + `req.user` attribution (Phase 1b/1e) |
| MLC (mlc.routes) | ✓ Phase 1b + `stripAuditFields` on update (Phase 4b.1) |
| LAMA/DAMA (lama-dama.routes) | ✓ Phase 1b + `stripAuditFields` (Phase 4b.1) |
| Emergency (emergency.routes) | ✓ `authenticateToken` on all 5 POST/PUT; no body identity reads |
| Critical-values ack (critical-values.routes `/acknowledge`) | ✓ Phase 1d — `req.user.username` |
| HMIS-sync management routes | ✓ No body identity reads |
| Login (login.routes) | ✓ Authentication module itself — no identity leaks |
| Department, Doctor (many endpoints) | ✓ Mostly `authenticateToken` on write routes; no body identity reads |

### WEBHOOK — server-to-server, deferred to webhook-HMAC backlog (3 clusters, 8 endpoints)

| Cluster | Endpoints | Deferral target |
|---|---|---|
| HMIS webhooks | POST `/webhooks/payment-confirmed`, `/webhooks/lab-result-ready`, `/webhooks/radiology-result-ready`, `/webhooks/pharmacy-dispensed`, `/webhooks/bed-status-update`, `/webhooks/discharge-confirmed` | Webhook HMAC signature verification — Sprint 4b backlog (separate item) |
| WhatsApp-bot webhook | POST `/:apiKey/:whatsappNumber` | Same |
| Public website contact form | POST `/` on `callback.routes.ts` | Stays public; captcha/rate-limit is the correct control, not auth |

**Do not apply `authenticateToken` to webhooks** — per 4b.2 policy, these are server-to-server and need signature/IP-whitelist controls, not JWT.

---

## 0.3 Summary count

| Risk class | Count | Remediation |
|---|---|---|
| CRITICAL | **8 call sites / 5 files** | In-scope for 4b.2 |
| HIGH | **7 call sites / 5 files** | In-scope for 4b.2 |
| MEDIUM | **1 call site / 1 file** | In-scope for 4b.2 (prophylactic) |
| LOW (no-auth on non-identity-writing endpoints) | ~50+ endpoints | **Defer to Sprint 4c** (frontend-coordinated sweep) |
| WEBHOOK | 8 endpoints | Defer to webhook-HMAC backlog item |
| NONE (clean) | rest of the surface | ✓ |

**Total in-scope for 4b.2: 16 call sites across 10 files.**

---

## 0.4 Remediation plan

### CRITICAL remediations (5 files × ~15–25 LOC each)

All 5 controllers currently lack `authenticateToken`. The fix is twofold per handler:

1. **Add middleware** to the route: `authenticateToken` (plus `requireClinicalActor` for clinical models: doctor-notes, history-notes, er, opd — all clinical per NABH MRD.1. TabletMaster is pharmacy-master, not a clinical transaction — use `authenticateToken` without requireClinicalActor).

2. **Close the body-spread / direct-read** in the handler:

```ts
// Before (CRITICAL pattern):
const newNote = await prisma.doctorNote.create({ data: req.body });

// After:
const actorId = getClinicalActor(req, res);
if (actorId === null) return;
const newNote = await prisma.doctorNote.create({
  data: {
    ...stripAuditFields({ ...req.body }),
    createdBy: req.user!.username,
    createdById: actorId,  // only if column exists; doctor-notes has no createdById today
    updatedBy: req.user!.username,  // on updates
    updatedById: actorId,
  },
});
```

**Per-file specifics:**

| File | Create path | Update path | Test count |
|---|---|---|---|
| doctor-notes.controller.ts | stripAuditFields + stamp createdBy + (model has no createdById — add it as a 4b.2 sub-migration? see Q3 below) | same pattern | 2 (happy + impersonation) |
| history-notes.controller.ts | same | same | 2 |
| er.controller.ts | ERAssessment.createdBy is Int — stamp with `actorId` directly; `stripAuditFields` strips body's `createdBy` | same | 2 |
| opd.controller.ts | create already field-by-field (safe); only update needs stripAuditFields | update only | 1 |
| prescription.controller.ts (TabletMaster) | change `createdBy: req.body.doctorId` → `createdBy: req.user!.username` (or the signed-in doctor's id if attribution is doctor-specific) | N/A | 1 |

**Subtotal:** 8 new tests; ~80–100 LOC changes.

### HIGH remediations (5 files × ~5–10 LOC each)

Replace `req.body.userId` with `req.user.id` in the 7 handler sites. Apply `authenticateToken` to the 5 lock routes that currently lack it (estimation, services, service-radiology, therapy — all `lock*` handlers).

| Handler | Fix |
|---|---|
| `createAppointment` | apply `authenticateToken` to POST /; replace `req.body.userId` with `req.user?.id ?? null` |
| `updateAppointment` | already has authenticateToken; swap body→req.user |
| `lockAppointment` | already has authenticateToken; swap body→req.user |
| `lockService` (estimation) | add `authenticateToken`; swap body→req.user.id |
| `lockService` (services) | same |
| `lockService` (service-radiology) | same |
| `lockTherapyAppointment` (therapy) | add `authenticateToken`; swap body→req.user.id |

**Subtotal:** 14 new tests (happy + impersonation per handler); ~30–50 LOC changes.

### MEDIUM remediation (1 file × 2 LOC)

Wrap the patient-create body-spread with `stripAuditFields` prophylactically. No column exists today, no behaviour change today, but the pattern no longer creates a future-leak.

```ts
// Before:
const newPatient = await prisma.patientDetails.create({
  data: { ...patientData, created_at: new Date() },
});

// After:
const newPatient = await prisma.patientDetails.create({
  data: { ...stripAuditFields(patientData), created_at: new Date() },
});
```

**Subtotal:** 0 tests (no behaviour change to assert today); ~2 LOC.

### Defer

- **LOW endpoints** (~50+ no-auth non-identity-writing routes) — defer to Sprint 4c. Rationale: requires frontend-coordination verification (which clients already send JWT) to avoid prod breakage. This is a sweep, not an urgent bug fix.
- **Webhook HMAC signing** — separate Sprint 4b backlog item, unchanged.

---

## 0.5 Risk flags & decision points

### Q1 — Clinical vs non-clinical middleware on CRITICAL fixes

**Question:** For doctor-notes, history-notes, er, opd — should I apply `requireClinicalActor` (stricter guard, already used for IPD/MLC/LAMA/DAMA) or just `authenticateToken`?

**Recommendation:** **`requireClinicalActor` on doctor-notes, history-notes, er, opd**. These are clinical documentation (NABH MRD.1 scope). TabletMaster (prescription.controller tablets POST) is a reference-data master write, not a clinical transaction → `authenticateToken` suffices.

### Q2 — Adding createdById / updatedById columns to DoctorNote, HistoryNotes, OPDAssessment, ERAssessment?

**Current state:**
- DoctorNote, HistoryNotes: have `createdBy String?`, `updatedBy String?` — no typed id.
- OPDAssessment, ERAssessment: have `createdBy Int?` only — no `updatedBy`, no `updatedById`.

**Question:** Bring these to MRD.1 uniformity (the 7 IPD-family models all have `{createdBy, updatedBy, createdById, updatedById}` after 4b.1)?

**Recommendation:** **NO, not in 4b.2.** Scope creep. 4b.2 is about closing the identity leak on columns that already exist. Adding uniform audit columns across OPD/ER/doctor-notes/history-notes is a Phase 4b.1-sibling migration that warrants its own audit phase. **Defer to 4c or a dedicated phase.** For 4b.2, stamp whichever columns exist today and skip the ones that don't.

### Q3 — appointment.controller.ts `req.body.userId || null` — allow the legacy fallback?

The three appointment handlers currently accept `req.body.userId || null` — the `|| null` fallback allowed unauthenticated/scripted creation (e.g. public-website "request appointment" flow). After fix, `req.user?.id ?? null` preserves the "null when unauthenticated" behavior if the route lacks `authenticateToken`, OR fails the request if auth is required.

**Recommendation:** Apply `authenticateToken` only where the frontend guarantees a logged-in user. For `createAppointment` — public website can request appointments anonymously (this is by design). Keep the route **unauthenticated** but **remove the body-read**. Replace `req.body.userId` with `req.user?.id ?? null` — when there's no auth, it's null (legitimate "anonymous booking"); when there is auth, it's the JWT id. **Still closes the impersonation loophole** because `req.body.userId = 999` is no longer honored.

For `updateAppointment` and `lockAppointment`, they already have `authenticateToken` — straight swap.

For H4–H7 (lock handlers across estimation/services/service-radiology/therapy): always authenticated from the admin panel. Apply `authenticateToken`.

### Q4 — `POST /broadcast` on critical-values.routes.ts

The testing endpoint at [critical-values.routes.ts:38](../../src/api/hmis-sync/critical-values.routes.ts#L38) is currently unauthenticated and manually broadcasts alerts. Anyone can fire fake critical-value alerts.

**Recommendation:** **Add `authenticateToken`** (LOW → fixed inline during 4b.2, 1 LOC). It's a testing / manual-broadcast endpoint; locking it requires no frontend coordination.

### Q5 — `prescription.controller.ts:108` — `createdBy: req.body.doctorId`

This is attribution of a tablet master row to a doctor. The intent seems to be "which doctor added this tablet to the catalog?" If that's the case, it should be `req.user!.username` (the logged-in doctor/admin).

**Recommendation:** Replace with `createdBy: req.user!.username`. Drop `doctorId` from the body contract entirely.

### Q6 — Scope: all CRITICAL + HIGH + MEDIUM, or CRITICAL + HIGH only?

**Recommendation:** **All three (CRITICAL + HIGH + MEDIUM).** MEDIUM is a 2-LOC prophylactic that costs nothing and prevents a future bug. No reason to split.

### Q7 — Test count and file distribution

Total new tests proposed: **24**.

| Test file | New tests | Notes |
|---|---|---|
| `doctor-notes.controller.test.ts` (**new**) | 2 | Happy + impersonation on create+update |
| `history-notes.controller.test.ts` (**new**) | 2 | Same |
| `er.controller.test.ts` (**new**) | 2 | Same |
| `opd/__tests__/opd-update.test.ts` (**new**) | 1 | Update happy + impersonation |
| `prescription.controller.test.ts` (**new**) | 1 | TabletMaster createdBy server-derived |
| `appointments/__tests__/appointment-identity.test.ts` (**new**) | 6 | 3 handlers × (happy + impersonation) |
| `estimation/__tests__/lock-service.test.ts` (**new**) | 2 | Happy + impersonation |
| `services/__tests__/lock-service.test.ts` (**new**) | 2 | Same |
| `service-radiology/__tests__/lock-service.test.ts` (**new**) | 2 | Same |
| `therapy/__tests__/lock-appointment.test.ts` (**new**) | 2 | Same |
| `patient.controller.test.ts` (**new**) | 0 | MEDIUM — no behaviour change to assert until columns exist |
| `critical-values-broadcast.test.ts` (**new**) | 2 | Q4 — auth required for /broadcast |

Wait, Q4 adds 2 tests — updated total: **26**.

Alternative: extend existing test files where they exist (few do for these controllers — most are Cluster C). **Recommendation: create new test files** — keeps Phase 4b.2 assertions auditable and discoverable. Mirrors the 4b.1 pattern (`mlc-updates.test.ts`, `lama-dama-updates.test.ts`).

**Total test count after 4b.2: 161 + 26 = 187.**

---

## 0.6 Scope recommendation

**Execute all CRITICAL (5 files) + HIGH (5 files) + MEDIUM (1 file) + Q4 `/broadcast` fix — 12 file targets, ~26 new tests.**

Defer to Sprint 4c:
- LOW endpoints (~50+ no-auth routes — frontend-coordinated sweep).
- Audit-column additions to DoctorNote/HistoryNotes/OPDAssessment/ERAssessment (Q2).
- Webhook HMAC signing (separate 4b backlog item).

**Estimated 4b.2 execution:** ~130–180 LOC changes across 12 files, 26 new tests, zero new migrations.

---

## 0.7 Decision matrix

| # | Question | Recommended |
|---|---|---|
| Q1 | `requireClinicalActor` on the clinical CRITICAL fixes (doctor-notes, history-notes, er, opd)? | **Yes.** TabletMaster gets `authenticateToken` only. |
| Q2 | Add `createdById`/`updatedById` columns to DoctorNote/HistoryNotes/OPDAssessment/ERAssessment in 4b.2? | **No.** Defer to a separate column-uniformity phase. Stamp existing columns only. |
| Q3 | `createAppointment` — keep anonymous booking allowed (no `authenticateToken`) while still fixing the leak? | **Yes.** Keep route public; swap body-read for `req.user?.id ?? null` — closes the leak without breaking public booking. |
| Q4 | Fix the unauthenticated `/broadcast` testing endpoint in 4b.2? | **Yes.** Add `authenticateToken` — 1 LOC, 2 tests. |
| Q5 | `prescription.controller.ts:108` — replace `createdBy: req.body.doctorId` with `req.user!.username`? | **Yes.** Drop `doctorId` from the POST body contract. |
| Q6 | Scope: CRITICAL + HIGH + MEDIUM all in 4b.2? | **Yes.** |
| Q7 | Create new test files per controller (vs extending existing ones, most of which don't exist)? | **New files** — mirrors 4b.1 pattern. |

---

## 0.8 Proposed execution order (pending approval)

1. **Route-middleware updates** — add `authenticateToken` (+ `requireClinicalActor` where applicable) to 10 routes + `/broadcast`. ~15 LOC across 7 routes.ts files.
2. **Handler fixes — CRITICAL** — stripAuditFields + server-derived stamping on 5 controllers (doctor-notes, history-notes, er, opd, prescription). ~100 LOC.
3. **Handler fixes — HIGH** — swap `req.body.userId` → `req.user?.id` across 7 call sites in 5 controllers (appointment, estimation, services, service-radiology, therapy). ~40 LOC.
4. **Handler fix — MEDIUM** — wrap patient-create body-spread with `stripAuditFields`. ~2 LOC.
5. **Tests** — create 10 new test files with 26 total assertions. ~400–500 LOC of test setup + assertions.
6. **Full suite run** — target **187/187 passing** (161 pre + 26 new, zero regression).
7. **Write `docs/modules/phase-4b-2-sync.md`** — covers the 12-file fix, the helper reuse, webhook deferral policy.
8. **Report in standard format.**

**Stopping here.** Awaiting user response on Q1–Q7 + scope approval.
