# MODULE_MAP.md — Docminds HMIS Integration

Audit date: 2026-04-18.
Derived from `CURRENT_STATE.md` + `GAP_ANALYSIS.md` + `HMIS_Integration_Plan.html`.

This document captures dependencies so Phase B proceeds in a correct order (leaf tables first, aggregate screens last).

---

## 1. Prisma model dependency graph

Arrows point from the foreign-key holder to the referenced model (`A → B` means "A has an FK to B"). Models with no outgoing FKs are leaves and are safe to patch first.

```
Hospital
Department ── (none)
User ──→ (User: self-referential via Doctor/Therapist)

Doctor ──→ Department, User
DoctorAvailability ──→ Doctor
UnavailableDates ──→ Doctor
BookedSlot ──→ Doctor
UnavailableSlot ──→ Doctor
ExtraSlot ──→ Doctor
ExtraSlotCount ──→ Doctor
LeaveDates ──→ Doctor
SentMessage ──→ Doctor

Appointment ──→ Doctor, Patient, User
Patient (── no FKs, but referenced by Appointment)
PatientDetails (── no FKs)

Channel ──→ Doctor
DoctorAssignment ──→ Channel, Doctor
Advertisement ─→ Channel (M:N)
AdvertisementMedia ──→ Advertisement

OPDAssessment ──→ (Doctor, Appointment — by id only, no relation decl.)
ERAssessment ──→ (Doctor, Appointment — by id only)

Prescription ──(Tablets cascade from prescription)
Tablet ──→ Prescription
TabletMaster ── (── no FKs)
FavoriteTablet ──→ TabletMaster
Allergy (── no FKs)

Lab, Radiology, Package ── leaves
InvestigationOrder ─→ Lab (M:N), Radiology (M:N), Package (M:N)

DoctorNote (── no FKs declared)
HistoryNotes (── no FKs declared)

# --- NEW HMIS models ---

HmisAuditLog         (── leaf, no FKs — safe to patch first)
InvestigationResult  (── leaf, references orderId/prn as strings not FKs)

Emergency              (── no hard FKs — references appointmentId by id)
  └─ EmergencyProgressNote ──→ Emergency (cascade)
  └─ MlcCase              ──→ Emergency (cascade, 1:1)
  └─ LamaRecord           ──→ Emergency (cascade, 1:1)
  └─ DamaRecord           ──→ Emergency (cascade, 1:1)

IpdWard                (── leaf among IPD)
IpdBed                 ──→ IpdWard (cascade)
IpdAdmission           ──→ IpdWard, IpdBed
  └─ IpdProgressNote   ──→ IpdAdmission (cascade)
  └─ IpdDischarge      ──→ IpdAdmission (cascade, 1:1)
  └─ IpdPrescription   ──→ IpdAdmission (cascade)
IpdMedicationLog       ── (references prescriptionId + admissionId as strings, no FK decl)

# --- Extras ---
Therapy, Therapist, TherapyAppointment, TherapyAppointmentTherapist, TherapyAppointmentTherapy
EstimationDetails / OTDetails / FollowUpDate / Inclusion / Exclusion / RadioService / ServiceAppointments / etc.
CallbackRequest
```

### Build/fix order for schema work (leaves → aggregates)

If any schema edits are needed in Phase B, this is the safe order:

1. `HmisAuditLog` (leaf, matches plan; nothing to patch)
2. `InvestigationResult` (leaf, matches plan; nothing to patch)
3. `LamaRecord`, `DamaRecord` — add `hmisPushed: Boolean @default(false)`
4. `MlcCase` — decide on field renames (recommend: **skip rename**, map at controller boundary; rename is low-benefit, high-risk with existing data)
5. `IpdWard` / `IpdBed` — decide on `hmisBedrId` typo (recommend: **skip rename**, leave as-is; field is optional)
6. `IpdDischarge` — add `doctorSignature: String?` (NABH MRD.3)
7. `IpdAdmission` — decide on `sourceModule` vs. booleans (recommend: **keep current design**, it's more flexible)
8. `Patient` / `PatientDetails` — **do not touch until user resolves the `hmisUhid` contradiction in the plan**

Every change above is **additive** (new optional columns). No data-destroying migrations expected.

---

## 2. API ↔ Model matrix

Each route touches one or more models. Used for blast-radius analysis when patching.

| Route prefix | Controllers | Models read/written |
|---|---|---|
| `/api/patients` | `patient.controller.ts` | Patient, PatientDetails, (HmisAuditLog on push) |
| `/api/appointments` | `appointment.controller.ts` | Appointment, Doctor, Patient |
| `/api/opd` | `opd.controller.ts` | OPDAssessment, Appointment, (→ creates IpdAdmission via conversion) |
| `/api/emergency` | `emergency.controller.ts` | Emergency, EmergencyProgressNote, HmisAuditLog |
| `/api/mlc` | `mlc.controller.ts` | MlcCase, Emergency, HmisAuditLog |
| `/api/lama-dama` | `lama-dama.controller.ts` | LamaRecord, DamaRecord, Emergency, HmisAuditLog |
| `/api/investigation` | `investigation.controller.ts` + `investigation-sync.ts` | InvestigationOrder, Lab, Radiology, Package, HmisAuditLog |
| `/api/prescription` | `prescription.controller.ts` + `prescription-sync.ts` | Prescription, Tablet, Allergy, HmisAuditLog |
| `/api/ipd` | `ipd.controller.ts` | IpdAdmission, IpdProgressNote, IpdDischarge, IpdBed, IpdWard |
| `/api/ipd-pharmacy` | `ipd-prescription.controller.ts` | IpdPrescription, IpdMedicationLog, IpdAdmission |
| `/api/ward` | `ward-management.controller.ts` | IpdWard, IpdBed |
| `/api/hmis-sync` | `hmis-sync.controller.ts`, `hmis-client.ts`, `hmis-audit.ts`, `hmis-sync.queue.ts` | HmisAuditLog, InvestigationResult, Appointment (auto-checkin), IpdBed (status update), IpdAdmission (discharge-confirm) |
| `/api/critical-values` | `critical-value-sse.ts`, `critical-values.routes.ts` | InvestigationResult (read), in-memory SSE subscriber map |
| conversion helpers | `opd-to-ipd.ts`, `emergency-to-ipd.ts` | OPDAssessment → IpdAdmission, Emergency → IpdAdmission, IpdPrescription (carryover), HmisAuditLog |

---

## 3. Frontend screen → API route mapping

| Angular component / path | Calls backend endpoints | Figma frame (TBD) |
|---|---|---|
| `patient/patient-overview` | `GET /api/patients` | TBD |
| `patient/patient-new` | `POST /api/patients` | TBD |
| `assessment/opd-assessment` | `POST /api/opd`, `POST /api/investigation/investigation-orders`, `POST /api/prescription`, `POST /api/opd/admit-to-ipd` (button missing) | TBD |
| `emergency/emergency-overview` | `GET /api/emergency`, `GET /api/emergency/stats`, `GET /api/emergency/queue/pending` | TBD |
| `emergency/emergency-intake` | `POST /api/emergency` | TBD |
| `emergency/emergency-list` | `GET /api/emergency` | TBD |
| **(missing)** emergency-progress-note | `POST /api/emergency/:id/progress-note` | TBD |
| `mlc/mlc-cases` | `GET /api/mlc`, `GET /api/mlc/stats` | TBD |
| **(missing)** mlc-register | `POST /api/mlc/register` | TBD |
| **(missing)** mlc-examination | `PUT /api/mlc/:id/examination`, `POST /api/mlc/:id/upload-photos`, `POST /api/mlc/:id/upload-signature` | TBD |
| **(missing)** mlc-samples | `PUT /api/mlc/:id/samples` | TBD |
| **(missing)** mlc-report | `PUT /api/mlc/:id/report`, `POST /api/mlc/:id/upload-submission-proof` | TBD |
| `discharge/lama-dama` | `GET /api/lama-dama`, `GET /api/lama-dama/lama-list`, `GET /api/lama-dama/dama-list`, `GET /api/lama-dama/stats` | TBD |
| **(missing)** lama-dama-form | `POST /api/lama-dama/lama`, `POST /api/lama-dama/dama`, `POST /api/lama-dama/*/upload-*-signature` | TBD |
| `ipd/ipd-overview` | `GET /api/ipd/admissions`, `GET /api/ipd/stats` | TBD |
| `ipd/ipd-admission` | `POST /api/ipd/admission`, `GET /api/ward/wards`, `GET /api/ward/beds/available?wardId=` | TBD |
| **(missing)** ipd-progress-note | `POST /api/ipd/admission/:id/progress-note`, `GET /api/ipd/admission/:id/progress-notes` | TBD |
| **(missing)** ipd-discharge | `POST /api/ipd/admission/:id/discharge`, `GET /api/ipd/admission/:id/discharge`, `GET /api/ipd/admission/:id/discharge-pdf` | TBD |
| **(missing)** ipd-pharmacy-carryover | `GET /api/ipd-pharmacy/admission/:id/review-carryover`, `POST /api/ipd-pharmacy/admission/:id/continue`, `PUT /api/ipd-pharmacy/prescription/:id/modify`, `PUT /api/ipd-pharmacy/prescription/:id/discontinue` | TBD |
| **(missing)** ipd-pharmacy-mar | `GET /api/ipd-pharmacy/admission/:id/mar`, `POST /api/ipd-pharmacy/prescription/:id/administer`, `GET /api/ipd-pharmacy/admission/:id/pending` | TBD |
| `ward-management/ward-census` | `GET /api/ward/wards`, `GET /api/ward/bed-census`, `GET /api/ward/occupancy-trends` | TBD |
| `ward-management/bed-census` | `GET /api/ward/beds`, `PUT /api/ward/bed/:id/status` | TBD |
| `services/critical-values-alert` (global) | `GET /api/critical-values/stream?userId=` (SSE), `GET /api/critical-values/alerts` | TBD |
| **(missing)** investigation-results list | `GET /api/investigation/results/:prn` (or similar) | TBD |
| `hmis-sync/sync-status` | `GET /api/hmis-sync/audit-logs`, `GET /api/hmis-sync/status`, `GET /api/hmis-sync/stats`, `GET /api/hmis-sync/health`, `POST /api/hmis-sync/sync/:logId/retry`, `POST /api/hmis-sync/sync/retry-all`, `GET /api/hmis-sync/audit-logs/download` | TBD |

All "TBD" entries require a Figma frame from the user before Phase B Step 6 can execute.

---

## 4. Module build-and-fix order for Phase B

Derived from the plan's Sprint sequence, refined by dependency analysis and current state.

### Sprint 1 — Foundation (mostly already in place; finish gaps)

1. **Patient & HMIS Foundation**
   - Clarify `hmisUhid` with user (plan self-contradiction)
   - Add Express `Request` augmentation file (`src/types/express.d.ts`) to kill 40+ `(req as any)` casts
   - Verify `hmis-client.ts` has auth + retry + timeout
   - Verify `.env.example` lists `HMIS_API_BASE_URL`, `HMIS_API_KEY`
   - Fix cron retry schedule from `*/30 * * * *` → `0 * * * *` (per plan)

2. **HmisAuditLog coverage gap closure** (pre-req for every other module)
   - Write reusable helper that wraps push + audit in one call; retrofit all existing push points to use it
   - **No new push function should exist without audit coverage**

### Sprint 2 — OPD Sync (already complete; verify)

3. **OPD Prescription + Investigation** — already wired; only verify push functions actually hit HMIS URL under realistic payloads. Tests missing.
4. **Auto check-in webhook** — present, just add 1-2 integration tests.
5. **Critical-value SSE** — backend present; **frontend: register `CriticalValuesAlertComponent` in `app.module`** or convert to standalone and add to root `AppComponent` template.

### Sprint 3 — IPD Module (biggest work)

> Schema → Backend → Frontend → Sync → Figma parity, one module at a time.

6. **IPD Wards/Beds** — backend ✅, frontend ✅. Verify transfer button works end-to-end; add audit log on `transferPatient`.
7. **IPD Admission** — backend missing HMIS push + audit log on create/update. **Patch** `ipd.controller.createIpdAdmission` to call `pushIPDAdmission` + log success/failure. Add tests.
8. **IPD Progress Notes** — **frontend build from scratch** (form + list). Backend exists; just add HMIS push + audit log + HTTP methods in `ipd.service.ts`.
9. **IPD Discharge** — backend patch (HMIS push on create, bed→available verification, `doctorSignature` column added). **Frontend build from scratch** (form + PDF download). Follow-up automation verification.
10. **IPD Pharmacy / MAR** — **frontend build from scratch** (carryover review, continue/modify/discontinue dialogs, MAR grid, administer dialog with signature). Backend patch (HMIS push + audit on each op).
11. **OPD → IPD / Emergency → IPD conversion buttons** — backend ✅. **Frontend: add buttons and prefill.**

### Sprint 4 — Non-IPD clinical (MLC, LAMA/DAMA, Emergency follow-up)

12. **MLC schema patches** — decide renames. Add tests.
13. **MLC frontend** — build 4 missing forms (registration, examination, samples, report) with signature + photo upload.
14. **LAMA/DAMA schema patches** — add `hmisPushed` column. Decide field renames.
15. **LAMA/DAMA frontend** — build create form with dual-signature capture (ngx-signaturepad already in deps).
16. **Emergency progress-note UI** — frontend build; backend patch (HMIS push + audit log).
17. **`pushMlcToHmis`, `pushLamaToHmis`, `pushDamaToHmis`** — new push functions in `hmis-client.ts`.

### Sprint 5 — NABH audit & hardening

18. **Investigation results viewer** (frontend) + critical thresholds config.
19. **Follow-up admin screen** — list of pending reminders; trigger manual send.
20. **Global theme tokens** — extract CSS custom properties for color/spacing/typography; replace hardcoded values module-by-module. Must wait on Figma.
21. **Webhook signature verification (HMAC) + rate limiting** — security hardening.
22. **Tests everywhere** — each module patch should add happy-path + failure-path tests. Briefing requires this per module; prior run added zero.
23. **Remove `(req as any)` casts** — done in Sprint 1 foundation; final sweep.

---

## 5. Figma frame ↔ screen mapping (all TBD)

**Pending user action.** Figma URL is gated. Create `docs/figma/` and drop exports as:

```
docs/figma/
├── patient/
├── opd/
├── emergency/
├── emergency-progress-note.png
├── mlc/
├── lama-dama/
├── ipd-admission.png
├── ipd-progress-note.png
├── ipd-discharge.png
├── ipd-pharmacy-mar.png
├── ward-census.png
├── investigation-results.png
├── critical-values-banner.png
├── hmis-sync-status.png
└── theme-tokens.png   ← color/typography tokens reference
```

Once those exist, Phase B Step 6 (Figma parity) can run per module.

---

## 6. Cross-cutting prerequisites (do these before Sprint 3 starts)

These are foundational items that affect every later module. Worth nailing before touching IPD UI work:

| Item | Type | Impact |
|---|---|---|
| `Request.user` type augmentation | Backend foundation | Fixes 40+ TS `any` violations at once |
| Reusable push + audit wrapper | Backend foundation | Eliminates audit-log misses by construction |
| Cron retry schedule fix | 1-line | Aligns with plan |
| `hmisUhid` plan contradiction resolution | Requires user | Blocks any `Patient` schema change |
| Global CSS tokens (even a starter set) | Frontend foundation | Lets all new IPD/MLC/LAMA screens use tokens from day 1 rather than being retrofitted |
| Figma frame exports | User action | Blocks parity checks (Step 6) |
| Register `CriticalValuesAlertComponent` globally | Frontend foundation | Un-blocks SSE alerts showing to doctors |

---

## 7. "Known-unknown" items to confirm while patching

These claims are from the prior-run self-report and should be verified by running the code, not trusted:

- Does `createDischarge` actually toggle the bed back to `available`?
- Does `follow-up-automation` actually create `Appointment` rows and dispatch SMS/WhatsApp?
- Does `discharge-pdf-generator` actually open/close correctly under Windows paths?
- Does `hmisSyncQueue.retryFailedSyncs` respect exponential backoff per-log, or is it a global 30-min tick?
- Does `syncPatientToHmis` include `hmisUhid` in its payload (it can't, because the column doesn't exist yet)?
- Does `syncInvestigationOrderToHmis` handle partial lab results vs. full reports separately?

Each of these becomes a test case during its respective module patch.
