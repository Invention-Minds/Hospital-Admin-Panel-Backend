# Sprint 4a · Phase 1c — Follow-up Appointment Automation · Step 0 Audit

**Date:** 2026-04-20 · **Status:** Audit-only. Waiting on user approval of the strategy before writing code.

---

## 0.1 What the existing file does today

**File:** [src/api/ipd/follow-up-automation.ts](../../src/api/ipd/follow-up-automation.ts) (315 lines).

Exports:
- `createFollowUpAppointment(dischargeId, admissionId, followUpDate?, followUpDoctorId?, customReason?)` — inserts an `Appointment` row and writes a success/failure audit log.
- `getPendingFollowUps(daysWindow)` — fetches upcoming follow-up rows for reminder dispatch.
- `sendFollowUpReminders()` — iterates pending and (TODO) calls SMS/email. Currently logs + flips `remainder1Sent = true`.
- `initializeFollowUpReminders()` — registers a `node-cron` job at `0 8 * * *` (daily 8am) invoking `sendFollowUpReminders`.
- Helper: `getFollowUpConfig(department, diagnosis)` — picks from a 7-entry hard-coded default rule set (Surgery 7d, Cardiology 5–7d, Orthopedics 14d, General Medicine 7–10d, plus a "General — 7 days" fallback).

### Is it called?

**Yes, two live call paths:**

1. **On discharge save** — [ipd.controller.ts:617](../../src/api/ipd/ipd.controller.ts) (inside `createDischarge`, under `if (finalDischarge.followUpDate)`). Error is caught and logged; discharge still returns 201. Call args:
   ```ts
   createFollowUpAppointment(
     finalDischarge.id,
     admissionId,
     new Date(finalDischarge.followUpDate),
     undefined,        // Use discharge doctor
     `Follow-up after ${finalDischarge.finalDiagnosis}`
   );
   ```
2. **Daily cron** — `initializeFollowUpReminders()` is wired into [src/index.ts:127](../../src/index.ts) at server startup. Cron runs daily at 8am and dispatches reminders (currently log-only; no SMS/email).

The wiring is **already correct** — the controller's error-swallow policy matches the user's "don't block discharge on follow-up failure" requirement.

---

## 0.2 The latent FK mismatch at line 138

**Confirmed: real bug.**

```ts
const patient = await prisma.patientDetails.findFirst({
  where: { prn: parseInt(admission.prn) },
});
...
const appointment = await prisma.appointment.create({
  data: {
    patientId: patient.id,   // ← BUG: patient.id is PatientDetails.id, column FK-points to Patient.id
    ...
  },
});
```

### What happens at runtime

Schema confirms: `Appointment.patientId Int?` with `@relation("AppointmentToPatient", fields: [patientId], references: [id])` → FK to `Patient.id`. Prisma generates a real MySQL `FOREIGN KEY` constraint. `PatientDetails.id` and `Patient.id` are independent auto-increment PKs; they only coincide for patients that happen to have both rows with the same sequence number, which is NOT guaranteed — especially for patients registered via emergency-only paths that may skip one side.

### Observed behaviour under the FK

| Case | Result |
|---|---|
| `PatientDetails.id === Patient.id` for this patient (coincidence) | Insert succeeds; `patientId` points to a real, correct `Patient` row by accident |
| `PatientDetails.id !== Patient.id` and both exist | Insert either (a) succeeds with a `patientId` pointing at the wrong `Patient` (wrong patient's appointment!), or (b) fails FK constraint if `patient.id` doesn't happen to be a valid `Patient.id` |
| `patient.id` corresponds to no existing `Patient` | MySQL FK constraint violation → `prisma.appointment.create` throws → caught by the outer try → `createHmisAuditLog` writes a `'follow_up_creation_failed'` audit row → caller (`createDischarge`) swallows the error → **discharge returns 201 with NO follow-up appointment created** |

### Is `Appointment.patientId` nullable? Would the insert ever silently succeed as orphan?

The column is `Int?` (nullable), so Prisma would accept `null`. But the code **always passes a non-null `patient.id`**, so the nullable tolerance doesn't help here. The FK constraint on non-null values enforces referential integrity; the bug either gets silently wrong data (wrong Patient match) or fails loudly (FK violation → audit log of failure).

Net: **follow-up appointments are unreliable in production today** — they either link to the wrong patient, or fail silently behind the error-swallow.

---

## 0.3 What SHOULD happen post-discharge (NABH ACC.5)

### Correct identity linkage

Per the going-forward rule from Sprint 3c+ ("patient lookup via PRN → PatientDetails, not Patient.id"):

- `Appointment.prnNumber: Int?` exists on the model — **this is the correct primary identifier** for the patient linkage. Set it to `parseInt(admission.prn)`.
- `Appointment.patientId: Int?` — either leave it `null` (strict going-forward rule) or look up the `Patient` row by `prn` and set a real `Patient.id` there for backward-compat. **My lean: leave it null.** New code shouldn't perpetuate the dual-identity pattern; `prnNumber` is the single source of truth for patient lookup going forward.
- Denormalized display fields (`patientName`, `phoneNumber`, `email`) can be copied from `PatientDetails` (mobile > contact > empty fallback).

### Doctor assignment

Current code at line 128: `(discharge.createdBy ? parseInt(discharge.createdBy) : 1)` — treats `discharge.createdBy String?` (a username) as a stringified doctor id. This is wrong on two levels:
1. `createdBy` holds a **username**, not a doctor id — `parseInt('Dr. Ravi')` is `NaN`.
2. Even if it parsed, `createdBy` is the _discharging staff member_, not necessarily a doctor (could be reception-1, nursing-staff, etc.).

**Correct approach:**
- Prefer `followUpDoctorId` param (explicit override).
- Fallback: `discharge.followUpDoctor` — a String? column on `IpdDischarge` (line 1527 in schema). Not an id; it's a name/title. Use it as denormalized `doctorName` only.
- If neither: look up a Doctor by `admission.admittingDoctor` (also a string name) — best-effort name match.
- If still no match: create the Appointment with `doctorId: null` and `doctorName: followUpDoctor ?? admittingDoctor ?? 'Follow-up Doctor'`. The scheduling UI can be used later to assign a concrete doctor.

**No fallback to doctorId = 1.** That's an arbitrary row.

### Time slot

Current: `time: '10:00'` hardcoded. No slot-availability check. Risk: duplicate or conflicting slots.

**Proposal for Phase 1c:** keep `time: '10:00'` as default for v1; **don't** invoke slot-availability/scheduling logic this phase. Flag slot-conflict resolution as 4b or later. Reason: follow-up scheduling sophistication is its own feature; Phase 1c scope is "close the NABH.ACC.5 loop", not "build a scheduler". The existing `isSlotAvailable` repository method ([appointment.repository.ts:21](../../src/api/appointments/appointment.repository.ts)) is available if/when we want to add conflict detection.

### HMIS push

**No `pushAppointment` exists in [hmis-client.ts](../../src/api/hmis-sync/hmis-client.ts).** The HMIS integration plan mentioned it as Phase 3, but it was never implemented. Appointments flow INTO the system via the HMIS payment-confirmed webhook (check-in), not OUTBOUND. The existing code uses `createHmisAuditLog` directly for an audit trail only — which is correct given the missing push client.

**Proposal:** keep audit-log-only (module=`'follow-up'`, action=`'appointment_auto_created'` / `'appointment_auto_creation_failed'`). Do NOT invent `pushAppointment`. If HMIS appointment outbound push becomes needed, that's Sprint 4+ work that extends the HMIS client itself.

### MRD audit attribution on the auto-created Appointment

Appointment doesn't have `createdBy String?` or `createdById Int?` — it has `userId Int?` (FK to User) which is the existing "who created" convention. From the user's question:

> *"Reserve User.id = 0 for SYSTEM OR use the discharge's own createdById as the follow-up appointment's createdById."*

**My pick: use discharge's createdById as the Appointment's `userId`.** Reasoning:
1. The discharging clinician is semantically the one who initiated this follow-up by filling `followUpDate`. Their identity propagating to the auto-created Appointment preserves the audit chain.
2. Reserving `User.id = 0` for SYSTEM requires creating a User row with `id = 0` or changing the FK semantics. Either way it's a schema-or-seed change on the critical path of Phase 1c.
3. The Phase 1b guard already ensures `discharge.createdById` is a valid positive integer — propagating is safe.

Fallback when `discharge.createdById` is null (legacy discharges from before Phase 1b deployed): leave `Appointment.userId = null`. The auto-creation still happens; the audit trail notes "auto-created from legacy discharge with no attributable creator".

### Edge cases and proposed handling

| Case | Proposed handling |
|---|---|
| `followUpDate` in the past | Skip creation. Write `appointment_auto_creation_skipped` audit row with `reason: 'followup_in_past'`. Don't error. |
| Same patient already has an appointment on that date | Skip creation. Write audit row with `reason: 'duplicate_same_day'`. Don't error. |
| Doctor lookup fails / `followUpDoctor` is a name we can't match | Proceed with `doctorId: null` + `doctorName` as a string. Appointment exists, scheduler UI can assign later. |
| `followUpDate` populated but `<= now()` (includes today) | Currently falls back to config-based rule. **Bug** — if clinician deliberately sets today, respect it. Change logic: `if (!followUpDate)` use config; else respect. |
| Patient not found via PRN | Write `appointment_auto_creation_failed` audit, don't throw. Discharge still completes. |

---

## 0.4 Decision options

### (a) Keep and fix — my recommendation

- Controller wiring is already correct; error-swallow is already correct; cron scheduler already lives here.
- The bugs are confined to the body of `createFollowUpAppointment`: FK misuse, doctor-id parsing, past-date fallback logic, no duplicate check.
- Fix scope: ~50 lines of diff inside this file, no structural change.
- Preserves `DEFAULT_FOLLOWUP_CONFIGS` as the rule-set — clinical lead can validate / override in their own 2-minute pass.

### (b) Delete and rewrite

- Delete the file, write a fresh `follow-up-service.ts` with clean semantics.
- Update the import in `ipd.controller.ts` + `index.ts`.
- More churn for the same end state; no architectural improvement.

### (c) Keep as-is, new logic separately

- Leaves broken code in place that's actively running in production on every discharge.
- Continues silent failure-audit writes.
- **Rejected.** Not appropriate to defer a known-broken clinical-continuity path.

**Recommendation: (a) keep and fix.**

---

## Proposed Phase 1c patch shape (for your approval)

```
src/api/ipd/follow-up-automation.ts
├── createFollowUpAppointment  — heavily rewritten body:
│     · Swap `patientId: patient.id` → `prnNumber: parseInt(admission.prn)` + `patientId: null`
│     · Swap `parseInt(discharge.createdBy) || 1` → explicit `followUpDoctorId` param / name-lookup / null
│     · Fix `if (!appointmentDate || appointmentDate <= new Date())` to respect explicit past-date
│       as "skip creation with audit log", and only fall back to config on undefined/null
│     · Add duplicate-detection: query `appointment.findFirst({ where: { prnNumber, date } })`
│       → if hit, skip creation with audit log `duplicate_same_day`
│     · Stamp `userId: dischargeCreatedById` (null fallback for legacy discharges)
│     · Audit module `'follow-up'` (change from `'appointment'`) for searchability
│     · Return  { status: 'created' | 'skipped' | 'failed', appointment?, reason? } instead of
│       throwing — aligns with caller's discharge-must-succeed contract
├── getPendingFollowUps  — untouched (works correctly today)
├── sendFollowUpReminders — untouched (TODO stub for SMS/email; not Phase 1c scope)
├── initializeFollowUpReminders — untouched (cron wiring intact)
└── DEFAULT_FOLLOWUP_CONFIGS — untouched (designer/clinical lead review per Q4 of main 4a plan)

src/api/ipd/ipd.controller.ts
└── createDischarge — minor cleanup only:
      · Pass `discharge.createdById` through as a new 6th param to createFollowUpAppointment
      · Inspect returned { status } and surface in discharge response message
        (e.g., "Discharge created. Follow-up appointment scheduled." vs
              "Discharge created. Follow-up skipped (past date)." vs
              "Discharge created. Follow-up could not be scheduled — see audit log.")

Tests (5–6 expected):
  1. Happy: followUpDate in future, patient exists, doctor resolves → Appointment created,
     prnNumber stamped, userId propagated, audit row 'appointment_auto_created'.
  2. Past-date: followUpDate < now() → skipped, audit 'appointment_auto_creation_skipped',
     reason 'followup_in_past'.
  3. Duplicate: patient already has appointment that date → skipped, audit 'duplicate_same_day'.
  4. Doctor not resolved: followUpDoctor name doesn't match any Doctor row → Appointment
     still created with doctorId=null + denormalized name.
  5. Patient not found: no PatientDetails row → failed, audit 'appointment_auto_creation_failed'.
  6. (optional) Legacy discharge without createdById → Appointment created with userId=null.

Estimated diff: ~80 lines in follow-up-automation.ts, ~10 in ipd.controller.ts, ~200 in tests.
```

### Additive migration needed?

**No.** Current Appointment schema has `prnNumber Int?`, `userId Int?`, `isfollowup Boolean?` — everything needed is already there. If Phase 1c wants to add a `followUpReason String?` column for human-readable reasons, that's optional and can be punted to a later phase.

---

## Open questions for your approval

1. **Option (a) keep-and-fix approved?** My strong recommendation, given the controller wiring is already correct and only the helper body needs surgery.
2. **Patient linkage: set `prnNumber` only and leave `patientId: null`**, or also populate `patientId` by looking up the `Patient` row via `prn` for backward-compat queries? My lean: prnNumber-only (going-forward rule). But flagging in case old reporting code joins on `Appointment.patientId → Patient.id`.
3. **Audit module name: `'follow-up'` (new) or `'appointment'` (existing)?** Current code uses `'appointment'`. `'follow-up'` gives auditors a cleaner query key. My lean: `'follow-up'`. Either is fine; the existing 'appointment' has exactly 2 audit-log calls so the rename is not disruptive.
4. **Time slot: hardcode `'10:00'` or add minimal conflict check via `isSlotAvailable`?** My lean: hardcode + skip-on-same-day-duplicate detection (which implicitly avoids time conflicts for the same patient). Full slot-conflict is 4b scope.
5. **Return shape: throw vs return `{ status, ... }`?** Current throws; caller swallows. Proposed: return an enum status so the controller can include it in the discharge response and surface to the UI without inspecting error messages. My lean: return shape.

No execution until approved.
