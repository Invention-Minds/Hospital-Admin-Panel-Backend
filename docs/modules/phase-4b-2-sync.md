# Phase 4b.2 — API-wide Server-Identity Audit · Sync Check

**Date:** 2026-04-21 · **Sprint:** 4b · Phase 4b.2.

Sweeps the write surface outside the 7 IPD-family clinical models and closes
every server-identity leak in the CRITICAL/HIGH/MEDIUM classes. Webhooks
remain deferred to the separate HMAC-signing backlog item.

---

## What changed

### CRITICAL — 5 controllers (8 leak sites), all closed

| # | File | Handler | Fix |
|---|---|---|---|
| C1+C2 | [doctor-notes.controller.ts](../../src/api/doctor-notes/doctor-notes.controller.ts) | `createDoctorNote`, `updateDoctorNoteByPRNAndDate` | `authenticateToken`+`requireClinicalActor` on route; `stripAuditFields` + stamp `createdBy`/`updatedBy` from `req.user.username` |
| C3+C4 | [history-notes.controller.ts](../../src/api/history-notes/history-notes.controller.ts) | Same two handlers | Same fix |
| C5+C6 | [er.controller.ts](../../src/api/er/er.controller.ts) | `createERAssessment`, `updateERAssessment` | `authenticateToken`+`requireClinicalActor`; `createdBy` is `Int` → stamp with `actorId`; `stripAuditFields` on both |
| C7 | [opd.controller.ts](../../src/api/opd/opd.controller.ts) | `updateOpdAssessment` (create was field-by-field-mapped, safe) | `authenticateToken`+`requireClinicalActor`; `stripAuditFields` on update |
| C8 | [prescription.controller.ts](../../src/api/prescription/prescription.controller.ts) | `createTablet` | `authenticateToken` on route; `createdBy: req.user.username` (was `req.body.doctorId`) |

### HIGH — 5 controllers (7 leak sites), all closed

| # | File | Handler | Fix |
|---|---|---|---|
| H1 | [appointment.controller.ts](../../src/api/appointments/appointment.controller.ts) | `createAppointment` | **Route stays public** (anonymous website booking); `userId = req.user?.id ?? null` — body `userId` ignored, null-fallback preserved |
| H2 | appointment.controller.ts | `updateAppointment` | `userId = req.user?.id ?? null`; `userId` explicitly destructured off `...updateData` so body spread can't leak it back in |
| H3 | appointment.controller.ts | `lockAppointment` | `userIdNum = req.user?.id`; hard 401 if no JWT |
| H4 | [estimation.controller.ts](../../src/api/estimation/estimation.controller.ts) | `lockService` | `userId = req.user?.id`; 401 if no JWT |
| H5 | [services.controller.ts](../../src/api/services/services.controller.ts) | `lockService` | Same pattern |
| H6 | [service-radiology.controller.ts](../../src/api/service-radiology/service-radiology.controller.ts) | `lockService` | Same |
| H7 | [therapy.controller.ts](../../src/api/therapy/therapy.controller.ts) | `lockTherapyAppointment` | Same |

Route middleware added: `authenticateToken` on `/services/:id/lock`, `/service-radiology/:id/lock`, `/therapy/lock/:id`, `/prescription/tablets`, `/critical-values/broadcast`.

### MEDIUM — 1 prophylactic fix

| # | File | Fix |
|---|---|---|
| M1 | [patient.controller.ts](../../src/api/patient/patient.controller.ts) | `createPatient` now wraps the body-spread with `stripAuditFields`. PatientDetails has no audit columns today; 2-LOC prophylactic prevents the pattern from re-opening the leak when columns are eventually added. |

### Q4 — `/critical-values/broadcast` locked

Previously unauthenticated testing endpoint now requires `authenticateToken`. No identity is stamped on the alert itself (in-memory + SSE only), but anonymous alert-spoofing is closed.

## `stripAuditFields` helper — reuse from Phase 4b.1

The helper added in 4b.1 ([audit-guard.ts](../../src/middleware/audit-guard.ts)) became the single source of truth for "fields that must never come from the client":

```ts
data: {
  ...stripAuditFields({ ...req.body }),
  createdBy: req.user!.username,
  updatedBy: req.user!.username,
}
```

**4 new call sites** in 4b.2 (doctor-notes create/update, history-notes create/update, er create/update, opd update, patient create) + the 3 from 4b.1 (mlc/lama/dama update-body-spread handlers). **7 total stripAuditFields usages** across the codebase, single helper — exactly the reuse pattern the 4b.1 sync doc predicted.

## Scope intentionally NOT covered in 4b.2 (deferred)

- **LOW findings (~50+ endpoints without `authenticateToken` but no identity writes).** Frontend-coordination required to verify JWT is sent before hardening. Deferred to Sprint 4c.
- **Column-uniformity migration** for DoctorNote/HistoryNotes/OPDAssessment/ERAssessment (adding `createdById`/`updatedById` Int columns to match the IPD-family models). Scope creep for 4b.2 — defer.
- **Webhook HMAC signing** (6 hmis-sync webhooks + whatsapp-bot + public callback). Separate 4b backlog item.
- **H4–H7 lock endpoints** still have the pre-existing rogue `new PrismaClient()` (Cluster C). Identity leak closed; client consolidation deferred to 4c.

## Test coverage — 25 new tests

| File | Tests | Coverage |
|---|---|---|
| `doctor-notes/__tests__/doctor-notes-identity.test.ts` (new) | 2 | Create happy/strip + update impersonation-close |
| `history-notes/__tests__/history-notes-identity.test.ts` (new) | 2 | Same pattern |
| `er/__tests__/er-identity.test.ts` (new) | 2 | Create Int-stamping + update impersonation-close |
| `opd/__tests__/opd-update-identity.test.ts` (new) | 1 | Update body-leak closed |
| `prescription/__tests__/tablet-identity.test.ts` (new) | 1 | TabletMaster createdBy from JWT (not body.doctorId) |
| `appointments/__tests__/appointment-identity.test.ts` (new) | 6 | 3 handlers × (happy + anon/impersonation variants); H1 anon-booking preserved, H3 401-no-JWT |
| `estimation/__tests__/lock-service-identity.test.ts` (new) | 2 | Happy + impersonation |
| `services/__tests__/lock-service-identity.test.ts` (new) | 2 | Same |
| `service-radiology/__tests__/lock-service-identity.test.ts` (new) | 2 | Same |
| `therapy/__tests__/lock-therapy-identity.test.ts` (new) | 2 | Same |
| `hmis-sync/__tests__/critical-values-broadcast-auth.test.ts` (new) | 2 | Route-stack assertion: `authenticateToken` present on `/broadcast`, absent on `/stream` |
| `patient/__tests__/patient-create-prophylactic.test.ts` (new) | 1 | Body-supplied audit fields stripped before create |

**Total: 25 new tests, 11 new test files.** Full suite: **186/186 passing, 31 suites** (161 pre-4b.2 + 25 new, zero regression).

### Reusable impersonation-test template (for 4c and beyond)

Every new test in 4b.2 follows the same attacker-vs-JWT pattern established in 4a Phase 1d and re-used in 4b.1:

```ts
const req = {
  body: {
    ...legitimatePayload,
    createdBy: 'attacker',   // impersonation attempt
    updatedBy: 'attacker',
    userId: 999,
  },
  user: { id: 42, username: 'alice' },  // JWT truth
};
await handler(req, res);
expect(mockPrisma.*.create/update.mock.calls[0][0].data).toEqual(
  expect.objectContaining({ createdBy: 'alice' })  // server wins
);
expect(args.data.createdBy).not.toBe('attacker');  // client loses
```

## Known gaps after 4b.2

1. **`createAppointment` is still public** by design (anonymous website booking). The `userId` field is null when no JWT is present — this is a correct representation of "public-request appointment" and is the pre-existing behaviour. If authentication is ever made mandatory on this endpoint, the null-fallback can be tightened to a 401.
2. **ERAssessment.updatedBy column does not exist** — we strip body-supplied `createdBy` on update but have no positive stamp to apply. If column-uniformity is later added, update-path stamping should be added alongside.
3. **DoctorNote / HistoryNotes typed `createdById`/`updatedById`** — string `createdBy`/`updatedBy` is stamped but the typed Int counterparts don't exist on these models. Same column-uniformity deferral as #2.
4. **LOW-severity endpoints** — ~50 routes without `authenticateToken`. Deferred per the audit scope decision; requires frontend-side check before hardening.

## Standing-rule reinforcement

The 4a Phase 1d + 4b.1 standing rule "server-derived identity only; body never wins" now applies across the API surface with one narrowly-scoped exception: the **public `createAppointment`** route, which accepts `null` identity (anonymous booking) but still ignores any `userId` the body tries to supply. Future handlers follow the pattern documented here: `stripAuditFields({ ...req.body })` + explicit stamp from `req.user`.
