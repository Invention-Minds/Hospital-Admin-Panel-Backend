# Phase 1c — Follow-up Appointment Auto-Creation · Sync Check

**Date:** 2026-04-20 · **Sprint:** 4a · Phase 1c.

Backend-only. Fixes the latent follow-up auto-creation feature that was silently failing on every IPD discharge (see [Step 0 audit](../sprints/sprint-4a-phase-1c-audit.md)).

---

## What runs now, end-to-end

```
IPD clinician saves discharge summary (with followUpDate populated)
   ↓
createDischarge controller writes IpdDischarge (Phase 1b: createdBy + createdById stamped)
   ↓
createFollowUpAppointment(dischargeId, admissionId, followUpDate, null, reason, createdById)
   ↓
   ├─ if !followUpDate                                 → skipped('no-follow-up-date') + audit
   ├─ if followUpDate < today (start-of-day)           → skipped('past-date') + audit
   ├─ if discharge.createdById is null (legacy)        → failed('no-responsible-doctor') + audit
   ├─ if PatientDetails not found via parseInt(prn)    → failed('patient-not-found') + audit
   ├─ if Appointment already exists (prn, date)        → skipped('duplicate') + audit
   └─ else → prisma.appointment.create({
              prnNumber, patientId: null,            // Going-forward rule
              patientName/phone/email (from PatientDetails),
              doctorId: null-or-explicit,            // No arbitrary doctorId=1
              doctorName: override||followUpDoctor||admittingDoctor,
              date, time: '10:00', status: 'pending', isfollowup: true,
              userId: dischargeCreatedById,          // MRD attribution propagated
            })
            + audit('appointment_auto_created', 'success')
            → returns { status:'created', appointmentId, appointmentDate }
   ↓
Controller renders the tagged status into a human sentence
   → appends to discharge 201 response.message
```

Discharge always succeeds regardless of follow-up outcome. Follow-up crashes are caught, audited, and reported in the response.

## HMIS audit log — new `module: 'follow-up'`

Registered in [hmis-sync-wrapper.ts HmisModule union](../../src/api/hmis-sync/hmis-sync-wrapper.ts) (documentation-only; `createHmisAuditLog.module` is typed `string` and accepts any value). Queryable via:

```sql
SELECT * FROM HmisAuditLog WHERE module = 'follow-up' ORDER BY createdAt DESC;
```

Actions emitted:
| Action | When | Status |
|---|---|---|
| `appointment_auto_created` | Appointment written | `success` |
| `appointment_auto_creation_skipped` | No follow-up date, past date, OR duplicate | `success` (intentional skip, not a failure) |
| `appointment_auto_creation_failed` | Discharge/admission not found, no-responsible-doctor, invalid PRN, patient-not-found, unexpected throw | `failed` |

The audit `payload` JSON always carries enough context to reconstruct the decision — discharge/admission ids, the skip/fail reason, and (when applicable) the conflicting appointment id + PRN + dates.

## Appointment write — exact column contract

| Column | Value |
|---|---|
| `prnNumber` | `parseInt(admission.prn)` — single source of truth for patient linkage (going-forward rule). |
| `patientId` | `null` — do NOT populate this column in new code. Legacy rows had a silent wrong-patient bug (see Step-0 audit §0.2). |
| `patientName` / `phoneNumber` / `email` | denormalized from `PatientDetails` via `prn`. |
| `doctorId` | explicit `followUpDoctorId` override if present and resolves; otherwise `null`. No arbitrary fallback. |
| `doctorName` | resolved doctor name → discharge.followUpDoctor → admission.admittingDoctor → `'Follow-up Doctor'`. |
| `department` | resolved doctor's departmentName or admission.department. |
| `date` | ISO-date string (YYYY-MM-DD). |
| `time` | `'10:00'` hardcoded. Slot-conflict detection via duplicate check only. Full conflict resolution is **4b scope**. |
| `status` | `'pending'`. |
| `isfollowup` | `true`. |
| `userId` | `dischargeCreatedById ?? discharge.createdById ?? null` — MRD.1 attribution propagated from the discharging clinician. Phase 1b guarantees this is non-null for new discharges; legacy discharges short-circuit to `failed('no-responsible-doctor')` so this is never `null` on an actually-created row. |

## Duplicate-detection semantics

Per user spec (Q4 answer): check for **any** Appointment on the same PRN and same date — not just follow-ups. If a patient already has a same-day appointment (regular or follow-up), skip auto-creation and surface the conflicting id in the audit payload. The clinician can reconcile via the scheduling UI.

## Legacy bad-data count (dev DB)

Read-only query at the start of Phase 1c:
- Total `Appointment` rows with `isfollowup = true`: **0**
- Rows with non-null `patientId`: **0**
- Orphaned `patientId` pointers: **0**

Dev DB has no legacy follow-up rows. The feature was broken from shipping but never accumulated rows because (a) discharge volume is low and (b) when it did fire, the FK violation would cause a silent fail-audit. Sprint 4c backlog includes a legacy-cleanup entry for when production data lands.

## MRD attribution gate — a deliberate choice

Per Phase 1b, new discharges always have `createdById`. Phase 1c now REFUSES to auto-create a follow-up when `createdById` is null (legacy discharge). Tradeoff:

- **Gain:** no Appointment row ever exists without a typed responsible clinician. NABH auditors can trust `SELECT * FROM appointments WHERE isfollowup = true AND userId IS NOT NULL` as the canonical set.
- **Cost:** legacy-discharge patients (if any) won't get auto-scheduled follow-ups; they're handled via the manual scheduler UI. Acceptable given the feature was unreliable pre-Phase 1c anyway.

## Existing reminder/cron subsystem — untouched

`getPendingFollowUps`, `sendFollowUpReminders`, `initializeFollowUpReminders` kept intact. The daily 8am cron runs as before. SMS/email integration remains a TODO (not Phase 1c scope).

## Known Gaps at End of Phase 1c

1. **Hardcoded `time: '10:00'`.** Full slot-availability detection (check `UnavailableSlot`, `BookedSlot`, `isSlotAvailable` from appointment.repository.ts) is 4b scope.
2. **Doctor resolution by name/id only — no user-based resolution.** The existing pattern requires explicit `followUpDoctorId`. Future enhancement: resolve a Doctor row via `discharge.createdById → User → Doctor(userId)` reverse lookup. Low priority; `doctorName` is always set denormalized even when `doctorId` is null.
3. **SMS/email reminder dispatch is log-only.** The cron ticks and logs; no external integration. 4b or later.
4. **Audit retention.** `HmisAuditLog` rows accumulate without rotation. Retention policy is a separate operational concern.
