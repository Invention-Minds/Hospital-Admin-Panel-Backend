# Sprint 3f — Admit-to-IPD · Sync Check

Frontend Admit-to-IPD surface against the Sprint 1 `convertOpdToIpd` + `convertEmergencyToIpd` helpers. First end-to-end exercise of those helpers — Sprint 2f's wrapper migration is now proven against UI callers.

Derived from:
- Frontend: [AdmitToIpdModalComponent](../../../Frontend/Hospital-Admin-Panel/src/app/shared/ui/admit-to-ipd-modal/), [OpdAssessmentsService.admitToIpd](../../../Frontend/Hospital-Admin-Panel/src/app/services/opd-assessment/opd-assessments.service.ts), existing [EmergencyService.convertToIPD](../../../Frontend/Hospital-Admin-Panel/src/app/services/emergency.service.ts).
- Backend: [convertOpdToIpd](../../src/api/conversion/opd-to-ipd.ts), [convertEmergencyToIpd](../../src/api/conversion/emergency-to-ipd.ts), [admitToIpd controller](../../src/api/opd/opd.controller.ts), [convertToIPD controller](../../src/api/emergency/emergency.controller.ts).
- Backend tests: [src/api/opd/__tests__/opd-admit.test.ts](../../src/api/opd/__tests__/opd-admit.test.ts), [src/api/emergency/__tests__/emergency-convert.test.ts](../../src/api/emergency/__tests__/emergency-convert.test.ts).

## 1. Modal → backend payload mapping

The modal collects 4–5 editable fields + passes the source identifier through context. Payload shapes differ slightly between the two endpoints.

### OPD → `POST /api/opd/admit-to-ipd`

| Modal field / context | Payload field | Notes |
|---|---|---|
| `context.sourceId` | body `appointmentId: number` | Modal normalizes string input to number before POSTing |
| form `wardId` | body `wardId: string` | Required |
| form `bedId` | body `bedId: string` | Required; filtered to `status='available'` in UI |
| form `admittingDoctorId` | body `admittingDoctorId: number \| null` | Optional — `DoctorService.getAllDoctors()` dropdown |
| form `admittingDoctorName` | body `admittingDoctorName: string` | Required |
| form `admissionType` | body `admissionType: 'elective' \| 'emergency' \| 'transfer' \| 'routine'` | Defaults to `'elective'` for OPD source |

### Emergency → `POST /api/emergency/:id/convert-to-ipd`

| Modal field / context | Payload field | Notes |
|---|---|---|
| `context.sourceId` | URL path `:id` | String in path, helper calls `parseInt` |
| form `wardId` | body `wardId: string` | Required |
| form `bedId` | body `bedId: string` | Required |
| form `admittingDoctorId` | body `admittingDoctorId: number \| null` | Optional |
| form `admittingDoctorName` | body `admittingDoctorName: string` | Required |
| form `admissionType` | body `admissionType: 'emergency' \| 'elective' \| 'transfer' \| 'routine'` | Defaults to `'emergency'` for Emergency source |

## 2. What the helpers do with each payload

### `convertOpdToIpd(appointmentId, wardId, bedId, admittingDoctorId, admittingDoctorName, admissionType)`

Source-of-truth file: [src/api/conversion/opd-to-ipd.ts](../../src/api/conversion/opd-to-ipd.ts).

1. `prisma.appointment.findUnique({ where: { id: appointmentId }, include: { doctor: true, patient: true } })`.
2. Fetches pending OPD `Prescription[]` rows where `prn` matches + `prescribedDate` within last 7 days.
3. Fetches pending `InvestigationOrder[]` rows for the same `prn`, including `labTests`, `radiologyTests`, `packages`.
4. Computes next `admissionNo = JMRH-IPD-####` from the last `ipdAdmission.findFirst({ orderBy: { id: 'desc' } })`.
5. `prisma.ipdAdmission.create(…)` with:
   - `sourceModule: 'opd'`, `referralOpdId: appointmentId.toString()`
   - `prn: appointment.patient.prn.toString()`
   - `admittingDoctor: admittingDoctorName`, `referringDoctor: appointment.doctor.name`
   - `department: appointment.doctor.departmentName || 'General'`
   - `roomType: 'general'` (hardcoded — see §6)
   - `diagnosis: "OPD Referral from {doctor.name}"` (generic placeholder — see §6)
   - `status: 'admitted'`
6. `prisma.ipdBed.update({ where: { id: bedId }, data: { status: 'occupied' } })`.
7. `syncWithHmis(…)` → `pushIpdAdmission(hmisPayload)`:
   - `direction: 'push'`, `module: 'ipd'`, `entityType: 'admission'`, `action: 'admission_from_opd'`.
   - HMIS payload includes `sourceModule`, `referralAppointmentId`, `admissionType`.
   - Wrapper writes success OR failure audit row; controller returns 201 either way.
8. Returns `{ ipdAdmission, pendingPrescriptions, pendingInvestigations }` — carry-forward rows are *returned as metadata* for the IPD Pharmacy review step (Sprint 3c `reviewCarryoverPrescriptions`), **not** inserted automatically into `IpdPrescription`.

### `convertEmergencyToIpd(emergencyId, wardId, bedId, admittingDoctorId, admittingDoctorName, admissionType)`

Source-of-truth file: [src/api/conversion/emergency-to-ipd.ts](../../src/api/conversion/emergency-to-ipd.ts). Similar shape, with three clinically important differences:

- **MLC linkage:** `prisma.mlcCase.findFirst({ where: { emergencyId } })`; when an MLC exists, `referralMlcId = mlcCase.id` is populated on the admission row and on the HMIS push payload (`mlcCaseId`).
- **Emergency status flip:** `prisma.emergency.update({ where: { id: emergencyId }, data: { status: 'admitted-ipd' } })` — the Emergency's dashboard badge reflects the admission.
- **Triage-based room type:** `roomType: emergency.triageCategory === 'red' ? 'ICU' : 'general'`. Red-triage patients land in ICU by default; user can't override this in the modal.
- Diagnosis default: `emergency.presentingComplaint || 'Emergency Admission'` — more useful than the OPD generic, since the Emergency intake captured a real complaint.
- Action: `'admission_from_emergency'`.

HMIS push payload adds `triageCategory` + `traumaScore` + `referralMlcId`.

## 3. Audit log signatures — confirmed via tests

### OPD happy path (`opd-admit.test.ts`)

Captured `createHmisAuditLog` arguments when `pushIpdAdmission` resolves:

```json
{
  "direction": "push",
  "module": "ipd",
  "action": "admission_from_opd",
  "payload": "<JSON: admissionNo, prn, referralOpdId, admissionType>",
  "response": "{\"entityType\":\"admission\",\"result\":{\"id\":\"HMIS-ADM-77\"}}",
  "status": "success",
  "retryCount": 0
}
```

### OPD failure path

When `pushIpdAdmission` rejects with axios-shape 503:

```json
{
  "direction": "push",
  "module": "ipd",
  "action": "admission_from_opd",
  "payload": "<same>",
  "response": "{\"entityType\":\"admission\",\"error\":{\"message\":\"...\",\"status\":503,\"detail\":{\"err\":\"HMIS down\"}}}",
  "status": "failed",
  "retryCount": 0
}
```

The controller still returns 201 (helper swallows HMIS failures per wrapper default). Admission is persisted, bed is occupied, just no `hmisAdmissionId` yet — opportunistic backfill is a separate manual step (not wired in Sprint 3f).

### Emergency happy path (`emergency-convert.test.ts`)

Same wrapper, with `action: 'admission_from_emergency'`. Also verifies `prisma.emergency.update` flips the emergency status to `admitted-ipd`.

### Emergency failure path

Same structure as OPD failure. Admission + bed + emergency status flips still happen; only the HMIS id remains null.

## 4. Side-effects per endpoint — confirmed

| Handler | Local DB writes | HMIS push | Response |
|---|---|---|---|
| `admitToIpd` (OPD happy) | `IpdAdmission` create + `IpdBed` → occupied | `pushIpdAdmission` → success audit | 201 with `{ipdAdmission, pendingPrescriptions, pendingInvestigations}` |
| `admitToIpd` (OPD HMIS fail) | Same local writes | Attempted, failed → failure audit | 201 with same shape, `hmisAdmissionId=null` |
| `admitToIpd` (validation) | None | None | 400 / helper throws on missing appointment |
| `convertToIPD` (Emerg happy) | `IpdAdmission` create + `IpdBed` → occupied + `Emergency.status='admitted-ipd'` | `pushIpdAdmission` → success audit | 201 with `{ipdAdmission, mlcCase, pendingPrescriptions, pendingInvestigations}` |
| `convertToIPD` (Emerg HMIS fail) | Same local writes | Attempted, failed → failure audit | 201 |
| `convertToIPD` (no emergency) | None | None | 404 |
| `convertToIPD` (validation) | None | None | 400 |

## 5. Carry-forward contract — clarified

The conversion helpers **return** pending prescriptions + investigations as response metadata. They do **not** insert `IpdPrescription` rows. The UI-facing pattern is:

```
Admit modal → helper returns { ipdAdmission, pendingPrescriptions, pendingInvestigations }
            → user eventually navigates to IPD Pharmacy (existing Sprint 3c UI)
            → /api/ipd/admission/:id/review-carryover returns the same pending rx list
            → user picks per-drug which to continue
            → /api/ipd/admission/:id/prescriptions/continue creates each IpdPrescription row
```

This two-step design is deliberate and predates Sprint 3f. The admit flow creates the bed+ward+doctor context; the pharmacy flow does the per-drug clinical review (dose can change, route can change, instructions can be tailored to IPD).

## 6. Open limitations carried from Sprint 1 helpers

Acknowledged, flagged, not blocking Sprint 3f. Backlog entries added.

1. **OPD diagnosis is a generic placeholder** — `"OPD Referral from {doctorName}"`. The modal lets the user see the OPD treatment-plan text in the context strip, but the admission record's `diagnosis` column gets the generic string until the first IPD Progress Note updates it. Backlog item in `sprint-3-backlog.md`.
2. **No `diagnosis` / `roomType` / `department` override params on the helper.** Modal respects this — doesn't offer editors for those fields. If hospital workflow demands specificity here, extend helper signatures as a Sprint 4 patch.
3. **No HMIS-id backfill in update endpoints.** If `pushIpdAdmission` fails at admit time, the admission row has `hmisAdmissionId=null` and no re-push happens on any subsequent admission update (unlike the LAMA/DAMA/MLC pattern). Sprint 4+ candidate if HMIS push failures turn out to be non-trivial in production.
