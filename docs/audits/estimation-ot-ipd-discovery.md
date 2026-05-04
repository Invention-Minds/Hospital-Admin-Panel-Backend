# Estimation + OT + IPD Discovery Audit (Pre-Sprint-3f)

**Date:** 2026-04-19 · **Scope:** Read-only discovery. No code/schema changes. Purpose: inform the Admit-to-IPD flow decision for Sprint 3f.

---

## 1. Executive summary

**Estimation** is a fully-built legacy module covering surgical cost-preview workflow — creation → submission → approval → PAC (pre-auth clearance) → confirmation → OT execution → completion, with WhatsApp notifications, PDF generation, and up to 5 follow-up dates. **It has zero HMIS integration** — no `hmisEstimationId`, no `pushEstimation*` client method, no audit log calls. It has **zero structural link** to `Appointment`, `IpdAdmission`, or `Emergency`. The workflow is **self-contained and doctor-initiated**, not triggered by the clinical-flow modules this sprint cycle has been building on.

**OT** is implemented entirely as **a sub-feature of Estimation**, not a distinct module. `OTDetails` is a child of `EstimationDetails` (1:N via `estimationId`), lives inside `src/api/estimation/`, has no routes outside `/api/estimation/ot-details*`, and uses a magic `estimationId = "emergency"` placeholder to represent standalone day-surgery bookings. It has zero link to `IpdAdmission` and zero HMIS integration. The OT TV kiosk (`/ot-channel`) consumes SSE events from the estimation backend. OT is functionally complete for legacy Docminds but architecturally orthogonal to the new HMIS-aware clinical flow.

**IpdAdmission** (built in Sprint 2) already has a referral-pointer pattern for source tracking (`sourceModule`, `referralOpdId`, `referralEmergencyId`, `referralMlcId`), but these are **loose string pointers with no `@relation` directive** — Prisma enforces no referential integrity, cascade deletes are impossible, and joins are manual. It has no `estimationId` or `otDetailsId` pointer. None of the IPD controller code references `EstimationDetails` or `OTDetails`.

**Bottom line:** Estimation+OT and IPD are two disconnected islands today. The original HMIS integration plan (`HMIS_Integration_Plan.html`) does not list `pushEstimation*` or `pushOt*` under Phase 3 push functions, and mentions "billing" only as a future `HmisAuditLog.module` enum value (never implemented). **Wiring Estimation into Sprint 3f would be a net-new scope expansion**, not a fill-in of documented intent.

---

## 2. Part 1 — Estimation findings

### 2.1 Schema

Two Estimation models live at [prisma/schema.prisma:466-601](../../prisma/schema.prisma).

**`Estimation`** (line 466-479) — this is a **template/preset storage**, not a live estimation:
- `id`, `doctorId` (FK Doctor), `departmentId` (FK Department), `estimation: String`, `estimationType: String?` (values: "MM", "SM", "Maternity").
- Relations: Doctor, Department.
- **No patient info, no lifecycle, no cost fields.** Used as a per-doctor-per-department template catalog.

**`EstimationDetails`** (line 521-601) — the live, per-patient estimation record. ~70 columns. Highlights:
- Patient identity: `patientName`, `patientPhoneNumber`, `patientEmail`, `patientUHID: Int?`, `ageOfPatient`, `genderOfPatient`. **Stores patient data inline; no FK to `Patient` or `PatientDetails`.**
- Doctor: `consultantId: Int`, `consultantName: String`. **Stored as scalar ID + name; no `@relation` to `Doctor`.**
- Cost breakdown: `estimationCost`, `discountPercentage`, `totalEstimationAmount`, seven room-tier cost fields (`costForDeluxe`, `costForGeneral`, `costForPresidential`, `costForPrivate`, `costForSemiPrivate`, `costForVip`, `selectedRoomCost`).
- Stay: `totalDaysStay`, `icuStay`, `wardStay`, `roomType`.
- Lifecycle: `statusOfEstimation: String?` (free-text, no enum) with observed values `pending | submitted | approved | rejected | confirmed | completed | cancelled | overDue`; `estimationStatus: String?` as a secondary/redundant status field.
- Lifecycle timestamps (all `DateTime?`): `estimationCreatedTime`, `submittedDateAndTime`, `approvedDateAndTime`, `confirmedDateAndTime`, `completedDateAndTime`, `cancellationDateAndTime`, `overDueDateAndTIme` (note: `T-I-m-e` typo preserved in schema).
- PAC (pre-auth clearance): `pacDone: Boolean?`, `pacAmountPaid: String?`, `pacReceiptNumber: String?`, `pacNotDoneReason: String?`.
- Signatures: `patientSign`, `employeeSign`, `approverSign` (all `String? @db.Text` — base64 blobs inline).
- Approvals/cancellations: `approverId`, `approverName`, `cancellerId`, `cancellerName`, `feedback`, `rejectReason`.
- Surgery/procedure: `surgeryTime`, `surgeryPackage`, `multipleSurgeries`, `multipleSurgeryDoctor`, `procedures`, `implants`, `instrumentals`.
- Lock: `lockedBy: Int?`, `userId: Int?` (concurrent-edit guard).
- PDF: `pdfLink: String?`.
- Relations: `followUpDates: FollowUpDate[]`, `inclusions: Inclusion[]`, `exclusions: Exclusion[]`, `OTDetails: OTDetails[]`. **No relation to `Appointment`, `IpdAdmission`, `Emergency`, `Patient`, `PatientDetails`.**
- **No HMIS columns** (`hmisEstimationId`, `hmisStatus`, etc. — absent).

**`FollowUpDate`** / **`Inclusion`** / **`Exclusion`** — simple child rows keyed by `estimationId: String` (references `EstimationDetails.estimationId`). Max 5 follow-ups enforced in controller.

### 2.2 Backend endpoints

All Estimation routes live at [src/api/estimation/estimation.routes.ts](../../src/api/estimation/estimation.routes.ts) and handlers at [src/api/estimation/estimation.controller.ts](../../src/api/estimation/estimation.controller.ts).

**Template endpoints** (work on `Estimation` model):
- `POST /api/estimation/` → `createEstimation`
- `GET /api/estimation/department/:departmentId/:estimationType` → templates by dept + type
- `GET /api/estimation/department/:estimationType` → templates by type

**Live estimation CRUD** (work on `EstimationDetails`):
- `POST /estimation-details` → `createEstimationDetails` — sends WhatsApp template `739377` to hardcoded staff phones; creates `estimation_request` notification for `sub_admin`; emits SSE.
- `POST /new-estimation-details` → `createNewEstimationDetails` — variant that also creates `Inclusion[]` / `Exclusion[]` rows.
- `GET /` → `getAllEstimationDetails` (excludes `estimationId='emergency'` rows)
- `GET /opd-estimation`, `GET /status-estimation`, `GET /estimation-details/followups`, `GET /get-confirmed`, `GET /confirmed-estimations`
- `GET /locked`, `PUT /:id/lock`, `PUT /:id/unlock`, `PUT /unlock-bulk`
- `PUT /estimation-details/:estimationId` → `updateEstimationDetails` — on status transition to `submitted` creates admin notification; on `rejected` sends WhatsApp template `796857`.
- `POST /estimations/:estimationId/follow-ups` → `updateFollowUps` (max 5)
- `PUT /estimation-details/:estimationId/advance` → `updateAdvanceDetails` (advance payment)
- `PUT /estimation-details/:estimationId/pacDone` → `updatePACDone` — sets `pacDone=true`, transitions status to `confirmed`, triggers OT TV reload if surgery is today.
- `PUT /estimation-details/:estimationId/confirm` → `estConfirm`
- `PUT /estimation-details/:estimationId/mark-complete` → `markComplete` — status `completed`, WhatsApp `726905`.
- `PUT /estimation-details/:estimationId/cancel` → `updateFeedback` — status `cancelled`, WhatsApp `726909`.
- `PUT /estimation-details/:estimationId/updateDate` → `updateSurgeryDate`
- `POST /generate-pdf` → `generateEstimationPDF` — PDF + FTP upload + WhatsApp send. **No auth middleware.**

**OT endpoints (colocated with Estimation — see §3 Part 2):**
- `POST /ot-details`, `PUT /ot-details/update`, `PUT /ot-details/start-finish`.

**HMIS wiring in this module:** `grep -r "createHmisAuditLog\|hmisClient\." src/api/estimation/` returns **zero matches**. None of the 20+ estimation write endpoints push to HMIS or log an audit row.

### 2.3 Frontend screens

Route entry: [src/app/app-routing.module.ts](../../../Frontend/Hospital-Admin-Panel/src/app/app-routing.module.ts) has a single line — `{ path: 'estimation', component: EstimationOverviewComponent, ... }`. All Estimation sub-screens are switched inside `EstimationOverviewComponent` via an `activeComponent` state machine, not routed.

Components (in `src/app/estimation/`):
| Component | Purpose | Status |
|---|---|---|
| `EstimationOverviewComponent` | Container + tab switcher + counts for 7 status buckets | built |
| `EstimationFormComponent` | Create new estimation (patient UHID search, surgery/room/cost, signatures) | built |
| `EstimationRequestComponent` | Pending/rejected/submitted queue | built |
| `EstimationApprovedComponent` | Approved queue | built |
| `EstimationConfirmedComponent` | Confirmed (post-PAC) queue | built |
| `EstimationSubmitComponent` | Submitted queue (variant) | built |
| `EstimationCompleteComponent` | Completed (terminal) | built |
| `EstimationCancelComponent` | Cancelled (terminal) | built |
| `EstimationOverdueComponent` | Overdue side-state | built |
| `FollowupEstimationComponent` | Follow-up date management | built |
| `MaternityEstimationComponent` | Maternity-type-specific variant | built |
| `CallBackComponent` | Sub-admin callback workflow (default tab for `role==='sub_admin'`) | built |
| `EstimationAnalyticsComponent` | Analytics (default tab for other roles) | built |

**Who initiates an estimation?** `EstimationFormComponent`, from within `EstimationOverviewComponent`. **Staff-initiated, not patient-facing.** The form has a UHID patient lookup, a doctor dropdown, an "Estimation Name" autocomplete (from `Estimation` templates), and captures patient + staff signatures inline.

**Cross-module entry points found:** none. No "Create Estimation" button in `AppointmentOverviewComponent`, `OpdAssessmentComponent`, `EmergencyOverviewComponent`, or `IpdOverviewComponent`. Search across all templates for navigations to `/estimation` returns only sidebar/header menu links, not per-patient flows.

### 2.4 Inferred workflow

**Estimation is a pre-treatment cost-preview and commitment workflow for surgical procedures.** Not a billing summary. Not a co-pay estimate. Not tied to OPD appointments.

```
[Staff opens Estimation Form]
        ↓ (manual patient search by UHID, manual doctor pick)
[Creates EstimationDetails: status='pending' or 'submitted']
        ↓ (WhatsApp 739377 → staff; notification → sub_admin)
[Sub-admin reviews in EstimationRequestComponent]
        ↓
[Approved | Rejected]                    (Rejected → WhatsApp 796857)
        ↓
[Approved: advance payment recorded via /advance endpoint]
        ↓
[PAC: /pacDone → statusOfEstimation='confirmed' + OT TV reload]
        ↓
[Surgery day: OTDetails scheduled (see Part 2)]
        ↓
[OT started → isStarted=true, startedTime=now]
[OT ended → isEnded=true, endedTime=now, EstimationDetails.statusOfEstimation='completed']
        ↓
[markComplete → WhatsApp 726905]         [cancel at any point → WhatsApp 726909]
[Up to 5 FollowUpDate rows]
```

**Ownership:** creator = staff (typically front-office coordinator with `role==='sub_admin'`); approver = admin/sub_admin; executor = OT coordinator via the OT UI.

**Standalone or tied?** Standalone. Does not require an Appointment, OPD assessment, Emergency case, or IPD admission to exist. The patient identity is captured as scalar fields (name, phone, UHID as Int) without any FK to `Patient` / `PatientDetails`.

**Blocking behaviour:** none. An estimation confirming or completing does not trigger an IPD admission, does not auto-create an admission record, does not surface anywhere in the IPD UI.

---

## 3. Part 2 — OT findings

### 3.1 Schema

**`OTDetails`** ([schema.prisma:889-914](../../prisma/schema.prisma)) is the only OT model. Fields:
- `id`, `estimationId: String` (FK → `EstimationDetails.estimationId`, `onDelete: Cascade`), `roomNo`, `handledBy: String` (surgeon name as scalar — no FK to Doctor).
- Timing: `startedTime: DateTime?`, `endedTime: DateTime?`, `isStarted: Boolean`, `isEnded: Boolean`.
- Remarks: `remarks: String?`, `coordinatorId: String?`, `paid: Boolean?`.
- Patient snapshot (denormalized): `patientName: String?`, `prn: Int?`, `multipleSurgeryDoctor: String?`.
- Surgery details: `surgeryDate: String?`, `surgeryLevel: String?`, `surgeryName: String?`, `surgeryType: String?`.
- Timestamps: `createdAt`, `updatedAt`.

**Relations:** only `EstimationDetails` (many-to-one). **No FK to `IpdAdmission`, `Appointment`, `Emergency`, `Doctor`, `Patient`, or `PatientDetails`.**

**HMIS columns:** absent.

**Status columns:** booleans (`isStarted`, `isEnded`) and timestamps. No enum, no state-machine validation.

**Magic value:** `estimationId = "emergency"` is used as a placeholder when an OT is booked standalone (no real estimation exists). This is a string literal, not a FK — nothing enforces it.

### 3.2 Backend endpoints

Three write endpoints, all colocated in [estimation.controller.ts](../../src/api/estimation/estimation.controller.ts):

| Method | Path | Handler | Behaviour |
|---|---|---|---|
| `POST` | `/api/estimation/ot-details` | `createOTDetails` | Creates standalone OT with `estimationId: "emergency"`. Accepts room, surgeon, surgery name/type/level, PRN, patient name, paid status. Emits SSE `loadOtTv`. |
| `PUT` | `/api/estimation/ot-details/update` | `updateOTDetails` | Upsert: updates room/surgeon/coordinator/paid for an existing estimationId, or creates if missing. Emits SSE `loadOtTv`. |
| `PUT` | `/api/estimation/ot-details/start-finish` | `updateOTStartFinish` | Marks `isStarted=true, startedTime=now` (action=`start`) or `isEnded=true, endedTime=now` (action=`end`). On `end`, also sets parent `EstimationDetails.statusOfEstimation='completed'`. Emits SSE `loadOtTv`. |

**No GET endpoints specific to OT** — consumers read OTDetails via the `confirmedEstimations` and `get-confirmed` estimation endpoints which `include: { OTDetails: true }`.

**HMIS wiring:** none. No `pushOt*` exists in [hmis-client.ts](../../src/api/hmis-sync/hmis-client.ts) (verified — the exports end at `pushIPDDischarge` on line 565; the full push-export list is Patient / Emergency / OpdAssessment / InvestigationOrder / Prescription / IpdAdmission / IpdTransfer / IpdPrescription / IpdPrescriptionDiscontinue / IpdMedicationAdmin / Mlc × 2 / Lama × 2 / Dama × 2 / IPDDischarge — 16 total, zero OT or Estimation).

### 3.3 Frontend screens

Two routed entry points in [app-routing.module.ts](../../../Frontend/Hospital-Admin-Panel/src/app/app-routing.module.ts):
- `/surgery` → `OtOverviewComponent` (authGuard-protected)
- `/ot-channel` → `OtTvDisplayComponent` (authGuard-protected, kiosk display)

Components:
| Component | Purpose |
|---|---|
| `OtOverviewComponent` | Container shell, switches to `TodayOtComponent` |
| `TodayOtComponent` (~500 lines) | The actual OT scheduling + execution UI |
| `OtTvDisplayComponent` | Read-only TV kiosk; fetches confirmed estimations + their OTDetails; SSE-subscribed |

`TodayOtComponent` workflow:
1. Fetches `getConfirmedEstimations()` on init (estimations with `statusOfEstimation='confirmed'`).
2. Renders sortable/searchable queue with columns: Patient, PRN, Surgery Date, Status, Actions.
3. "Schedule OT" button opens popup → fills OTDetails fields → `POST /ot-details`.
4. "Start OT" / "Finish OT" buttons → `PUT /ot-details/start-finish`.
5. "Update Details" → `PUT /ot-details/update`.
6. SSE listener on `loadOtTv` triggers list refresh.

Scheduler role: **OT coordinator** (via the TodayOtComponent UI). Doctors can technically also use it — endpoints have no role check.

### 3.4 Inferred workflow

**Prerequisite:** an `EstimationDetails` with `statusOfEstimation='confirmed'` (or the magic `estimationId='emergency'` bypass for standalone day surgery).

**Flow:** OT coordinator sees confirmed queue → schedules OT (room, surgeon, date) → surgery day → starts OT → finishes OT → parent estimation auto-transitions to `completed`.

**Answers to the workflow questions:**

| Question | Answer |
|---|---|
| Does OT require estimation approval first? | **Structurally no** — the endpoints accept any `estimationId` (including the string `"emergency"`). In practice, the UI only lists confirmed estimations, so approval is a UX convention, not a hard gate. |
| Can OT be done as day-surgery (no IPD)? | **Yes, and always currently is** — because there is zero connection between OT and `IpdAdmission` in the schema. Every OT is effectively "day surgery" from the IPD module's perspective. |
| Who schedules OT? | OT coordinator via `TodayOtComponent`. No role enforcement at the backend; anyone with an auth token can call the endpoints. |

---

## 4. Part 3 — Relationships

### 4.1 FK map (what actually exists in the schema)

```
Patient (id)
  ├─ (via phoneNumber/email match, NO FK) → PatientDetails (prn @unique, hmisUhid)
  └─ (via patientId FK) → Appointment

Appointment
  ├─ (via appointmentId FK) → OPDAssessment
  └─ (via appointmentId FK) → Emergency.appointmentId   ← LOOSE String? pointer

Emergency (id, hmisEmergencyId)
  ├─ (via emergencyId FK) → MlcCase
  ├─ (via emergencyId FK) → LamaRecord
  └─ (via emergencyId FK) → DamaRecord

EstimationDetails (estimationId @unique) ← ISLAND, no inbound FKs from clinical flow
  ├─ → FollowUpDate (FK: estimationId)
  ├─ → Inclusion    (FK: estimationId)
  ├─ → Exclusion    (FK: estimationId)
  └─ → OTDetails    (FK: estimationId, CASCADE)

OTDetails ← only FK is to EstimationDetails

IpdAdmission (id = uuid, admissionNo, hmisAdmissionId, hmisTransferId)
  ├─ sourceModule: String         (enum-by-convention: "opd" | "emergency" | "direct")
  ├─ referralOpdId: String?       ← LOOSE pointer, no @relation
  ├─ referralEmergencyId: String? ← LOOSE pointer, no @relation
  ├─ referralMlcId: String?       ← LOOSE pointer, no @relation
  ├─ (FK) → IpdBed, IpdWard
  └─ (children via admissionId): IpdProgressNote, IpdDischarge, IpdPrescription
```

### 4.2 Specific answers

Does **Estimation** currently reference:
- **OPD appointments?** ❌ No FK. No `appointmentId` on `EstimationDetails`.
- **IPD admissions?** ❌ No FK. No `ipdAdmissionId` or equivalent on either `EstimationDetails` or `OTDetails`.
- **OT procedures?** ✅ `EstimationDetails.estimationId` ← `OTDetails.estimationId` (1:N, cascade delete).
- **Emergency cases?** ❌ No FK. The magic string `"emergency"` in `OTDetails.estimationId` is a placeholder value, not a pointer.

Does **OT** currently reference:
- **Estimation?** ✅ FK as above.
- **IPD admission?** ❌ No FK.
- **OPD appointment?** ❌ No FK.

### 4.3 Currently-implemented workflow (text flowchart)

```
ACTUAL STATE OF THE CODE — 2026-04-19

Clinical Flow Island:                  Estimation + OT Island:
────────────────────                   ─────────────────────
  Appointment                            (Staff opens EstimationFormComponent)
       ↓                                            ↓
  OPDAssessment                          EstimationDetails (patientUHID, consultantId
       ↓                                     — both as scalars, no FK)
  (via referralOpdId String?)                       ↓
       ↓                                 [submit → approve → PAC → confirm]
  IpdAdmission  ────────────────X──────X── → OTDetails (estimationId FK)
       ↓                                            ↓
  IpdProgressNote                          [schedule → start → end]
       ↓                                            ↓
  IpdPrescription / IpdDischarge           (estimation → completed)

  Emergency → MlcCase / LamaRecord / DamaRecord
       ↓
  (via referralEmergencyId String?)
       ↓
  IpdAdmission

No edges cross the dashed vertical line. Estimation+OT is fully
self-contained and runs in parallel to the clinical flow.
```

### 4.4 Gaps flowchart — what's missing

```
WHAT THE CODE DOES NOT HAVE

  Appointment → [no "Request Estimation" action anywhere] ──X→ EstimationDetails
  OPDAssessment → [no "Needs surgical estimation" trigger] ──X→ EstimationDetails
  Emergency → [no "Record emergency-OT" flow] ──X→ OTDetails
                (the "emergency" magic string is a stub, not a link)

  EstimationDetails → [no "Admit patient" action] ──X→ IpdAdmission
  OTDetails        → [no "Surgery during admission" link] ──X→ IpdAdmission
  IpdAdmission     → [no "Associated estimation" lookup] ──X→ EstimationDetails

  Patient/PatientDetails → [EstimationDetails uses denormalized
                            scalars (patientName, patientUHID: Int)
                            instead of a FK — patient renames or
                            PRN migrations will silently desync]
```

Specific issues flagged:

1. **`patientUHID` is `Int?`** in `EstimationDetails` but `PatientDetails.prn` is `String @unique`. Type mismatch blocks a direct FK migration without a backfill.
2. **`consultantId: Int`** with no `@relation` to `Doctor` — orphans possible if a doctor is deleted.
3. **IpdAdmission's three referral pointers** (`referralOpdId`, `referralEmergencyId`, `referralMlcId`) are bare `String?` — Prisma will not enforce existence. A deleted OPD appointment leaves a dangling reference on the admission.
4. **`estimationId = "emergency"`** magic string in `OTDetails` is fragile — any future `EstimationDetails` row created with the literal `estimationId = "emergency"` (theoretically possible since `estimationId` is `@unique`) would collide.

---

## 5. Part 4 — HMIS integration status

### 5.1 Code audit

| Module | `hmis*` columns in schema | `pushXxx` in hmis-client.ts | `createHmisAuditLog` calls |
|---|---|---|---|
| Estimation | ❌ none | ❌ none | ❌ zero (verified via grep) |
| OTDetails | ❌ none | ❌ none | ❌ zero |

Confirmed push exports in [hmis-client.ts](../../src/api/hmis-sync/hmis-client.ts) lines 540-565: `pushPatient`, `pushEmergencyToHmis`, `pushOpdAssessment`, `pushInvestigationOrder`, `pushPrescription`, `pushIpdAdmission`, `pushIpdTransfer`, `pushIpdPrescription`, `pushIpdPrescriptionDiscontinue`, `pushIpdMedicationAdmin`, `pushMlcCase`, `pushMlcUpdate`, `pushLamaCase`, `pushLamaUpdate`, `pushDamaCase`, `pushDamaUpdate`, `pushIPDDischarge`. **No estimation, no OT, no billing, no procedure.**

Also confirmed: `grep -r "createHmisAuditLog\|hmisClient\." src/api/estimation/` → 0 matches.

### 5.2 HMIS_Integration_Plan.html

File exists at [e:/Docminds/Backend/HMIS_Integration_Plan.html](../../../HMIS_Integration_Plan.html) (965 lines). Search results for `estimation|surgery|operation|billing|procedure|OTDetails`:

- **Line 285:** ASCII box diagram of HMIS server modules: `Patient Reg / Billing/OPD / LIS·RIS / Pharmacy / IPD·ADT`. "Billing/OPD" is listed as a module but no push function is documented for it.
- **Line 299:** "Captures: Triage vitals, ABCDE assessment, trauma scoring (ISS, GCS), presenting complaints, **procedures done**" — in the Emergency Assessment section. "Procedures done" here is a free-text field on the Emergency form, not the OT module.
- **Line 427:** "All Emergency findings (vitals, injuries, procedures done) auto-populate IPD admission summary" — again referring to the Emergency-captured text, not OT.
- **Line 535:** `proceduresDone String? @db.LongText` — field on `IpdDischarge`, not OT.
- **Line 694:** Comment in the plan's proposed `HmisAuditLog` schema: `module String // patient / opd / ipd / lab / pharmacy / billing`. "billing" is listed as a module value but never implemented — `EstimationDetails` creation is never logged.

**Zero mentions** of `OTDetails`, `Operation`, `Surgery`, `pushEstimation`, `pushOt`, `pushSurgery`, or `pushBilling`.

### 5.3 Interpretation

The HMIS integration plan was scoped around the **OPD → IPD clinical flow** (Phase 1–3 progression: OPD → Emergency → IPD → MLC/LAMA/DAMA) and **diagnostic orders** (lab, radiology, pharmacy). Estimation and OT were not part of the original HMIS plan. Their mention as `Billing/OPD` in the HMIS server diagram and as `billing` in the HmisAuditLog enum appears to be speculative/placeholder — no implementation code follows it.

---

## 6. Part 6 — Questions for the user

These are ambiguities I couldn't resolve from code alone. Numbered for easy reference:

1. **Is the existing `EstimationDetails` workflow considered canonical for Sprint 3+, or is it legacy slated for replacement?** The code is mature but architecturally disjoint from the clinical flow this sprint cycle has been building (patient-as-PatientDetails, HMIS-aware, PRN-based). Wiring IPD into this legacy shape locks in a conflict with Sprint 2's data model.

2. **`estimationType` enum values observed:** `"MM"`, `"SM"`, `"Maternity"`. What do `MM` and `SM` stand for? I assumed they're operational types (Major/Minor surgery?) but couldn't confirm. If you want me to check a live row set, I can query the DB.

3. **`statusOfEstimation` vs `estimationStatus` — why both?** Both are `String?`. The first is the one that gets manipulated across all state-transition endpoints. The second is set only in a few places and read in fewer. Safe to treat it as deprecated/legacy?

4. **`patientUHID: Int?` on `EstimationDetails`** vs `PatientDetails.prn: String @unique` — are these supposed to be the same identifier, and if so, was the `Int` → `String` migration just never done? Or is `patientUHID` a separate hospital-legacy identifier distinct from PRN?

5. **The `estimationId = "emergency"` magic string for standalone OT** — is this intended long-term, or was it a placeholder awaiting a proper "emergency OT" record type? If we're adding a real Emergency↔OT link, this placeholder becomes obsolete.

6. **PAC (pre-auth clearance) — is this for insurance TPA approval or internal hospital approval?** It would matter for the HMIS integration design: PAC as insurance TPA would belong in a billing push; PAC as internal approval is purely a UX lifecycle gate.

7. **Which role actually approves estimations in production?** Code shows `targetRole: 'admin'` for the "awaiting approval" notification and `localStorage.getItem('role')` checks for `'sub_admin'` on the default-tab selection. Is the flow sub_admin creates → admin approves, or sub_admin creates AND approves?

8. **For Sprint 3f's Admit-to-IPD flow: is estimation mandatory, optional, or out-of-scope?** This is the load-bearing design decision. Options A–E below, recommended Option A on the grounds that it matches existing code structure.

---

## 7. Recommendation for Sprint 3f

Five options, evaluated against **how much new work each requires**:

### Option A — Direct admission (OPD/Emergency → Admission, no estimation)
- **Work required:** Minimal. Build an Admit button on OPD and Emergency screens; pre-fill admission form with patient context from appointment/emergency; write admission via existing `POST /api/ipd/admissions` endpoint; push to HMIS via existing `pushIpdAdmission`.
- **Schema changes:** Probably zero — referral pointers already exist.
- **Matches existing code?** ✅ Yes. `IpdAdmission.sourceModule` + `referralOpdId` + `referralEmergencyId` are already there, and `pushIpdAdmission` already works.
- **Tradeoff:** No cost preview for the patient before admission. In Indian hospital practice this may or may not be acceptable — depends on how the hospital operationally handles billing (e.g., via a separate billing team post-admission).

### Option B — Admission with optional estimation (OPD/Emergency → Admission → Estimation created alongside)
- **Work required:** Same as A, plus a "Create Estimation" side action on the admission detail page that deep-links to the existing `EstimationFormComponent` with patient pre-fill.
- **Schema changes:** Minimal — could add `EstimationDetails.ipdAdmissionId: String?` as optional back-pointer if we want to surface "this admission's estimation" later. Not required for v1.
- **Matches existing code?** ✅ Mostly. Estimation stays self-contained; admission stays self-contained; they loosely link by shared PRN at read time.
- **Tradeoff:** Two parallel workflows visible in UI; user needs to know estimation exists as a sibling, not a step.

### Option C — Estimation-gated admission (OPD → Estimation → Approval → Admission)
- **Work required:** Significant. Would need to redirect OPD "Admit" button through `/estimation/new`, enforce estimation approval before allowing admission creation, add a gating flag.
- **Schema changes:** Requires hard coupling (FK both ways).
- **Matches existing code?** ❌ Contradicts the current design where admission can come from direct / emergency paths without estimation involvement at all. Would also gate emergency admissions on a bureaucratic approval — clinically wrong for trauma cases.
- **Not recommended.**

### Option D — Branched flow (OPD → if surgery → Estimation+OT → Approval → Admission+OT booking)
- **Work required:** Very large. Would need a branching UI, surgical-procedure capture in OPD assessment, OT scheduling from admission flow, new FKs throughout, HMIS push for estimation+OT.
- **Schema changes:** Major. Requires net-new `pushEstimation`/`pushOt` HMIS client methods, new audit log module values, FK additions to OTDetails and IpdAdmission, migration of `patientUHID` type.
- **Matches existing code?** ❌ Net-new architecture. Would effectively rewrite the Estimation module to be HMIS-aware, PRN-based, and admission-linked.
- **Not recommended for Sprint 3f.** Good Sprint 4+ candidate if hospital workflow actually needs it.

### Option E — Option A for v1, with a "Future: estimation/OT integration" flag in the roadmap
- **Work required:** Same as A.
- **Matches existing code?** ✅ Best fit.
- **Tradeoff:** Formally acknowledges that Estimation+OT remain a parallel island in this sprint, to be unified later if clinical workflow demands it.

### **Recommendation: Option A (equivalently Option E as the annotated version).**

Rationale:
1. It matches the existing `IpdAdmission.sourceModule` + `referralOpdId/referralEmergencyId` design that Sprint 2 already built and that the HMIS integration plan already anticipated.
2. It requires no schema migrations — `pushIpdAdmission` is already in the HMIS client, already tested, and already audited.
3. It preserves the option to add Estimation↔Admission linking later without rework.
4. It avoids conflating two architecturally different modules (legacy denormalized estimation + new PRN-based HMIS flow) during a sprint cycle that's been specifically about **extending** the clinical-flow design.
5. It lets Sprint 3f ship an Admit-to-IPD flow in a scope that matches prior sprints (3a, 3b, 3c, 3d, 3e — all single-module completions).

If the hospital's operational process genuinely requires cost-preview-before-admission, that's a valid follow-up sprint (3.5 or 4) with its own design review — not a scope stretch inside 3f.

---

## Appendix — Verification log

All load-bearing claims verified against source:
- `Estimation` model = template; `EstimationDetails` model = live record. Confirmed at [schema.prisma:466](../../prisma/schema.prisma) and [schema.prisma:521](../../prisma/schema.prisma).
- `EstimationDetails` has no `appointmentId`, `emergencyId`, `ipdAdmissionId`, or `hmis*` column. Verified by reading lines 521-601.
- `OTDetails` has only `estimationId` FK; no link to IPD or HMIS. Verified at [schema.prisma:889](../../prisma/schema.prisma).
- `IpdAdmission.referralOpdId`, `referralEmergencyId`, `referralMlcId` are `String?` without `@relation`. Verified at [schema.prisma:1458-1460](../../prisma/schema.prisma).
- `hmis-client.ts` has 16 push exports (Patient through IPDDischarge); no `pushEstimation*` or `pushOt*`. Verified at [hmis-client.ts:540-565](../../src/api/hmis-sync/hmis-client.ts).
- `grep -r "createHmisAuditLog\|hmisClient\." src/api/estimation/` → 0 matches.
- `HMIS_Integration_Plan.html` — searched for estimation/surgery/operation/billing/procedure/OTDetails across 965 lines; findings on lines 285, 299, 427, 535, 694 quoted above. None describe a push function for Estimation or OT.

No DB-level queries were run for this audit — all findings are from static schema + controller + route inspection. A live-data sanity check (e.g., `SELECT DISTINCT statusOfEstimation FROM estimation_details`) is available on request.
