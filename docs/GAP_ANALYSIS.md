# GAP_ANALYSIS.md — Docminds HMIS Integration

Audit date: 2026-04-18.
Grounded in `CURRENT_STATE.md` and the plan in `HMIS_Integration_Plan.html`.

## Legend

| Icon | Status | Meaning |
|---|---|---|
| ✅ | `EXISTS_AND_CORRECT` | Present, matches plan, leave alone |
| ⚠️P | `EXISTS_BUT_INCOMPLETE` | Present but missing fields/logic/endpoints → PATCH |
| ⚠️W | `EXISTS_BUT_WRONG` | Present but diverges from plan/Figma → REFACTOR |
| ❌ | `MISSING` | Not built → CREATE |
| 🗑️ | `EXTRA` | Exists but plan does not require it → flag for user |
| 🚫 | `BLOCKED` | Cannot verify (e.g., Figma gated) |

Rows are module-by-module. Sub-sections cover (a) schema, (b) backend routes/logic, (c) frontend screens.

---

## Module 0 — Patient & Appointment (Sprint 1 foundation)

### 0a. Schema

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| `Patient` — `prn` unique identifier | Yes | `prn: Int @unique` | ✅ |
| `Patient` / `PatientDetails` — `hmisUhid` field | Plan text says "PRN = UHID" (no separate field); Sprint 1 step says "add hmisUhid to PatientDetails" — **plan contradicts itself** | Not present | 🚫 **clarify with user** before any migration |
| `Appointment.checkedIn`, `checkedInTime` | Yes | Both present | ✅ |

### 0b. Backend

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| `POST /api/patients` creates patient, generates PRN, pushes to HMIS | Yes | `createPatient` does all three; audit log success + failure | ✅ |
| `POST /api/hmis-sync/webhooks/payment-confirmed` auto-checks in appointment | Yes | Registered, POST, handler sets `checkedIn=true`; audit logged | ✅ |
| `PUT /api/appointments/:id/checkin` manual check-in | Implied by plan | Present (line 81 of appointment.routes.ts) | ✅ |
| Express `Request` type augmentation for `req.user` | Implied by TS-strict rule | **Not present** — 40+ `(req as any)` casts | ⚠️W |

### 0c. Frontend

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| Patient list / register / details | Yes | `src/app/patient/{patient-overview,patient-new,patient-details,patient-info}` | ✅ |

---

## Module 1 — Emergency / Trauma (Phase 0A)

### 1a. Schema

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| `Emergency` (model name) | Plan says `Emergency` | Model `Emergency` present | ✅ |
| Fields: triageCategory, presentingComplaint, abcdeAssessment, traumaScore, vitals (BP/HR/RR/SpO2/Temp), proceduresDone, status, hmisEmergencyId | Yes | All present | ✅ |
| Auto-generated ER No (e.g. `JMRH-ER-2026-0001`) | Plan | Uses `prn: String @unique` as both PRN and ER identifier; naming format in code is worth verifying at creation time | ⚠️P — verify generator produces `JMRH-ER-YYYY-NNNN` pattern |
| `EmergencyProgressNote` | Yes | Present with `observation`, vitals | ✅ |

### 1b. Backend

| Endpoint (plan) | Currently exists? | Status |
|---|---|---|
| `POST /api/emergency/` create | ✅ `createEmergency`, pushes to HMIS, logs audit | ✅ |
| `GET /api/emergency/:id` | ✅ `getEmergency` | ✅ |
| `GET /api/emergency` list | ✅ `getEmergencyList` | ✅ |
| `POST /api/emergency/:id/progress-note` add note | ✅ `addProgressNote` | ⚠️P — **no HMIS push, no audit log** |
| `POST /api/emergency/:id/convert-to-ipd` | ✅ via `convertEmergencyToIpd` helper; pushes + logs | ✅ |
| `PUT /api/emergency/:id/status` | ✅ `updateEmergencyStatus` with audit log | ✅ |
| Extras not in plan: `by-date`, `queue/pending`, `stats`, `PUT /:id` general update | 🗑️ | flag for user — keep if they're used by the dashboard |

### 1c. Frontend

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| Emergency overview dashboard | Yes | `src/app/emergency/emergency-overview.component` | ✅ |
| Emergency intake form (triage, ABCDE, vitals, trauma score) | Yes | `src/app/emergency/emergency-intake/` | ✅ |
| Emergency queue list with triage badges | Yes | `src/app/emergency/emergency-list/` | ✅ |
| Progress-note form UI | Yes | **Service method exists; no component** | ❌ |
| "Admit to IPD" button on emergency detail | Yes | Service method exists; **button not wired in UI** | ❌ |

---

## Module 2 — MLC (Medico Legal Case) (Phase 0B)

### 2a. Schema

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| `MlcCase` | Yes | Present | ⚠️P |
| Field `firNumber` | Plan | Named `fir_No` | ⚠️W — rename requires data migration; decide whether to rename or map at API boundary |
| Field `firstExamination` | Plan | Named `firstExaminationDone` + `firstExaminationTime` | ⚠️W — map at boundary or rename |
| Field `photos` | Plan (array of URLs) | `photographsTaken: Boolean` + `photoUrls: String? @db.Text` | ⚠️P — acceptable split; verify `photoUrls` is JSON array of GCS URLs |
| Field `samples` | Plan | `samplesCollected: String?` + `sampleStorageInfo: String?` | ⚠️P — similar split |
| Field `reports` (final report submission) | Plan | `followUpExams` + `finalReport` + `reportSubmittedTo` + `submissionDate` + `submissionProof` | ✅ split is fine |
| `patientConsent`, `consentTime`, `consentSignature` | NABH | Present | ✅ |
| `examinerName`, `examinerSignature` | NABH MRD.2 | Present | ✅ |
| `status` enum (documented/examination-done/samples-collected/report-submitted/closed) | Plan | `status: String` (not enum) | ⚠️P — enforce allowed values at controller/service layer |

### 2b. Backend

| Endpoint (plan) | Currently exists? | Status |
|---|---|---|
| `POST /api/mlc/register` | ✅ | ⚠️P — **no HMIS push** (only audit log) |
| `GET /api/mlc/:id` | ✅ | ✅ |
| `PUT /api/mlc/:id/examination` | ✅ | ⚠️P — no HMIS push |
| `PUT /api/mlc/:id/samples` | ✅ | ⚠️P — no HMIS push |
| `PUT /api/mlc/:id/report` | ✅ | ⚠️P — no HMIS push |
| `GET /api/mlc/pending-reports` | ✅ | ✅ |
| `pushMlcToHmis()` function | Implied (audit trail to HMIS) | **Does not exist** | ❌ |
| Audit log on upload/close handlers | Required | Missing on `upload*`, `close` | ⚠️P |

### 2c. Frontend

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| MLC case list + filters + stats | Yes | `src/app/mlc/mlc-cases.component` | ✅ |
| MLC registration form | Yes | ❌ missing | ❌ |
| MLC examination form (injuries, examiner signature, photos upload) | Yes | ❌ missing | ❌ |
| MLC samples form (types, storage) | Yes | ❌ missing | ❌ |
| MLC report submission form (proof upload, police/court info) | Yes | ❌ missing | ❌ |
| MLC PDF report download trigger | Backend endpoint exists | UI trigger missing | ❌ |

---

## Module 3 — LAMA & DAMA (Phase 0C)

### 3a. Schema

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| `LamaRecord` | Yes | Present | ⚠️P |
| `LamaRecord.hmisPushed` field | Plan explicitly | **Missing** | ❌ |
| Field `patientReason` | Plan | Named `reasonForLama` | ⚠️W — rename or map |
| `DamaRecord` | Yes | Present | ⚠️P |
| `DamaRecord.hmisPushed` field | Plan | **Missing** | ❌ |
| Field `doctorAdvice` (DAMA) | Plan | Named `doctorRecommendation` | ⚠️W |
| Field `followUpDoctor` (DAMA) | Plan | Named `followUpAdvice` | ⚠️W |
| Signatures (`patientSignature`, `witnessName`, `witnessSignature`) | Yes | All present | ✅ |

### 3b. Backend

| Endpoint (plan) | Currently exists? | Status |
|---|---|---|
| `POST /api/lama-dama/lama` | ✅ `createLamaRecord`, audit logged | ⚠️P — no HMIS push |
| `POST /api/lama-dama/dama` | ✅ `createDamaRecord`, audit logged | ⚠️P — no HMIS push |
| `GET /api/lama-dama/:id` | ✅ `getLamaRecord` / `getDamaRecord` | ✅ |
| `pushLamaToHmis()` / `pushDamaToHmis()` functions | Implied | **Missing** | ❌ |

### 3c. Frontend

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| LAMA/DAMA list + stats + compliance report | Yes | `src/app/discharge/lama-dama.component` | ✅ |
| Create LAMA form (doctor advice, risk acknowledgment, patient + witness signatures) | Yes | ❌ missing | ❌ |
| Create DAMA form (recommendation, declination, signatures) | Yes | ❌ missing | ❌ |
| Signature capture (ngx-signaturepad already in deps) | Yes | Not used in LAMA/DAMA | ❌ |

---

## Module 4 — Conversion helpers (Phase 1.5)

### 4a. Backend

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| `opd-to-ipd.ts` helper | Yes | Present, pushes + audit-logs | ✅ |
| `emergency-to-ipd.ts` helper | Yes | Present, pushes + audit-logs, carries MLC link | ✅ |
| Carries forward OPD prescriptions with `pending-ipd-continuation` tag | Plan | Verify implementation marks prescriptions correctly — **needs code read** | ⚠️P |
| Carries forward Emergency vitals + MLC + procedures | Plan | Helper exists; verify field mapping | ⚠️P |
| Auto-creates `IpdAdmission` with `sourceModule` | Yes | Yes | ⚠️W — plan wanted booleans `referredFromOPD/referredFromER`; current design is single `sourceModule` enum-ish String. Defensible but divergent. Decide: keep or refactor. |

### 4b. Frontend

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| "Admit to IPD" button inside OPD assessment form | Yes | Backend endpoint exists; **button not surfaced in OPD UI** | ❌ |
| "Convert to IPD" action on Emergency detail | Yes | Backend endpoint exists; **not wired** | ❌ |
| After conversion: redirect to IPD admission form with pre-filled context | Plan | Missing | ❌ |

---

## Module 5 — IPD Admission / Ward / Bed (Phase 2)

### 5a. Schema

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| `IpdWard` | Yes | Matches plan | ✅ |
| `IpdBed` | Yes | Present; field `hmisBedrId` (typo vs. `hmisBedId`) | ⚠️P — rename optional; low risk since field is still optional |
| `@@unique([wardId, bedNumber])` constraint | Implied | Present | ✅ |
| `IpdAdmission` | Yes | Present; divergent source-tracking (sourceModule String vs. plan's two booleans) | ⚠️W — decide keep or refactor |
| `IpdAdmission.hmisUhid` | Plan lists it; but plan also says PRN = UHID | Not present | 🚫 clarify |

### 5b. Backend

| Endpoint (plan) | Registered | Status |
|---|---|---|
| `POST /api/ipd/admission` | ✅ `createIpdAdmission` | ⚠️P — **no HMIS push, no audit log** |
| `GET /api/ipd/admissions` | ✅ | ✅ |
| `GET /api/ipd/admission/:id` | ✅ | ✅ |
| `PUT /api/ipd/admission/:id` | ✅ | ⚠️P — no audit log |
| `GET /api/ipd/bed-census` | ✅ (under `/api/ward/bed-census`) | ⚠️W — endpoint path under `/api/ward/*`, plan expected under `/api/ipd/bed-census`. Decide: alias or document. |
| `GET /api/ipd/wards` | ✅ (under `/api/ward/wards`) | ⚠️W — same path divergence |
| `PUT /api/ipd/bed/:id/status` | ✅ (under `/api/ward/bed/:bedId/status`) | ⚠️W |
| `POST /api/ipd/transfer` | ✅ at `/api/ipd/admission/:id/transfer` | ⚠️W — path divergence; **no audit log, no HMIS push** |
| HMIS webhook `POST /api/hmis-sync/bed-status-update` | ✅ registered, POST, audit logged | ✅ |

### 5c. Frontend

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| IPD admission form | Yes | `src/app/ipd/ipd-admission/` | ✅ |
| IPD overview dashboard | Yes | `src/app/ipd/ipd-overview.component` | ✅ |
| Ward/bed census board | Yes | `src/app/ward-management/ward-census`, `bed-census` | ✅ |
| Bed transfer UI | Yes | Not confirmed present | ⚠️P |

---

## Module 6 — IPD Progress Notes

### 6a. Schema — already ✅ (see Module 5a for `IpdProgressNote`).

### 6b. Backend

| Endpoint (plan) | Currently exists? | Status |
|---|---|---|
| `POST /api/ipd/progress-note` | Actual path is `POST /api/ipd/admission/:admissionId/progress-note` | ⚠️W — path divergence, but arguably cleaner |
| `GET /api/ipd/progress-notes/:admissionId` | Actual: `GET /api/ipd/admission/:admissionId/progress-notes` | ⚠️W |
| HMIS push on progress-note save | Implied (NABH COP.2 audit trail) | ❌ missing |
| Audit log on progress-note save | Required | ❌ missing |

### 6c. Frontend

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| IPD progress-note SOAP form (subjective/objective/assessment/plan + vitals + nursing) | Yes | ❌ no component | ❌ |
| List/timeline view of prior notes for an admission | Yes | ❌ | ❌ |
| `ipd.service.ts` HTTP methods for progress notes | Required | Interface only, **no methods** | ❌ |

---

## Module 7 — IPD Discharge

### 7a. Schema

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| `IpdDischarge` | Yes | Present | ⚠️P |
| `medications` JSON | Plan | Stored as `String @db.LongText` (JSON-encoded string) | ⚠️P — works but not typed; acceptable for MySQL. Leave unless problems surface. |
| `doctorSignature` field | NABH MRD.3 requires signed within 24h | **Missing** | ❌ |

### 7b. Backend

| Endpoint (plan) | Currently exists? | Status |
|---|---|---|
| `POST /api/ipd/discharge` | Actual path `POST /api/ipd/admission/:admissionId/discharge` | ⚠️W path |
| `GET /api/ipd/discharge/:admissionId` | Actual `/api/ipd/admission/:admissionId/discharge` | ⚠️W path |
| HMIS push on discharge create | Plan | ❌ **missing** |
| Bed status → `available` on discharge | Plan | Verify `createDischarge` toggles bed — **needs code read** | ⚠️P |
| `GET /api/ipd/admission/:id/discharge-pdf` | Implemented (`downloadDischargePDF`) | ✅ |
| Auto-create follow-up appointment post-discharge | Plan | `follow-up-automation.ts` present | ⚠️P — verify actually triggers |

### 7c. Frontend

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| Discharge summary form | Yes | ❌ no component | ❌ |
| PDF download trigger | Yes | ❌ | ❌ |
| Discharge checklist (type, final dx, procedures, medications, follow-up) | Yes | ❌ | ❌ |
| Service HTTP methods | Required | Interfaces only | ❌ |

---

## Module 8 — IPD Pharmacy / MAR

### 8a. Schema — ✅ `IpdPrescription`, `IpdMedicationLog` present.

### 8b. Backend

| Endpoint (plan) | Currently exists? | Status |
|---|---|---|
| `POST /api/ipd/:id/pharmacy/review-carryover` | `GET /api/ipd-pharmacy/admission/:id/review-carryover` (method differs, path differs) | ⚠️W |
| `PUT /api/ipd/prescription/:id/continue` | `POST /api/ipd-pharmacy/admission/:id/continue` | ⚠️W method + path |
| `PUT /api/ipd/prescription/:id/modify` | `PUT /api/ipd-pharmacy/prescription/:id/modify` | ⚠️W path |
| `PUT /api/ipd/prescription/:id/discontinue` | `PUT /api/ipd-pharmacy/prescription/:id/discontinue` | ⚠️W path |
| `POST /api/ipd/prescription/:id/administer` | `POST /api/ipd-pharmacy/prescription/:id/administer` | ⚠️W path |
| `GET /api/ipd/:admissionId/pharmacy/pending` | `GET /api/ipd-pharmacy/admission/:id/pending` | ⚠️W path |
| `GET /api/ipd/:admissionId/pharmacy/administered` | Closest: `GET /api/ipd-pharmacy/admission/:id/mar` | ⚠️W |
| HMIS push on continue/modify/discontinue/administer | Plan | ❌ **all missing** |
| Audit log on each pharmacy op | Plan | ❌ **all missing** |

### 8c. Frontend

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| Carryover review table + continue/modify/discontinue actions | Yes | ❌ | ❌ |
| MAR grid (admin times × medications) | Yes | ❌ | ❌ |
| Administer medication dialog with signature | Yes | ❌ | ❌ |
| Pending meds board | Yes | ❌ | ❌ |

---

## Module 9 — HMIS Sync Core (Phase 3)

### 9a. Schema — ✅ `HmisAuditLog` present and matches plan.

### 9b. Backend

| File (plan) | Present? | Status |
|---|---|---|
| `hmis-sync.routes.ts` | ✅ | ✅ |
| `hmis-sync.controller.ts` | ✅ | ✅ |
| `hmis-client.ts` (outbound) | ✅ | ⚠️P — verify axios wrapper has auth headers, retry config, timeout |
| `hmis-sync.queue.ts` (cron) | ✅ | ⚠️W — retry schedule `*/30 * * * *` vs plan `0 * * * *` (hourly) |
| `hmis-audit.ts` | ✅ | ✅ |
| `critical-value-sse.ts` + `critical-values.routes.ts` | ✅ | ✅ |

| Webhook endpoint (plan) | HTTP | Present? | Status |
|---|---|---|---|
| `payment-confirmed` | POST | ✅ | ✅ |
| `lab-result-ready` | POST | ✅ | ✅ |
| `radiology-result-ready` | POST | ✅ | ✅ |
| `pharmacy-dispensed` | POST | ✅ | ✅ |
| `bed-status-update` | POST | ✅ | ✅ |
| `discharge-confirmed` | POST | ✅ | ✅ |

| Outbound push function (plan) | Present? | Actually called? |
|---|---|---|
| `pushPatient` | via `syncPatientToHmis` | ✅ called from `patient.createPatient` |
| `pushAppointment` | partial (`syncAppointment` admin route) | ⚠️ not auto-called after appointment create — verify |
| `pushOPDAssessment` | not confirmed present | ⚠️P — plan requires this post-save in OPD controller |
| `pushInvestigationOrder` | via `syncInvestigationOrderToHmis` | ✅ |
| `pushPrescription` | via `syncPrescriptionToHmis` | ✅ |
| `pushIPDAdmission` | exists but **not auto-called from `createIpdAdmission`** | ❌ |
| `pushIPDDischarge` | not called from `createDischarge` | ❌ |
| `pushMlc`, `pushLama`, `pushDama` | ❌ not found | ❌ |

### 9c. Frontend

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| HMIS sync status dashboard | Yes | `src/app/hmis-sync/sync-status.component` | ✅ |
| Audit log viewer with filters + CSV export | Yes | Present | ✅ |
| Per-module sync health cards | Yes | Present | ✅ |
| Retry controls (single / bulk) | Yes | Present | ✅ |

---

## Module 10 — Investigation Results + Critical-Value SSE

### 10a. Schema — ✅ `InvestigationResult`.

### 10b. Backend

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| `POST /api/investigation/investigation-orders` pushes order | ✅ `syncInvestigationOrderToHmis` | ✅ |
| Polling cron lab + radiology (5 min) | ✅ | ✅ |
| `InvestigationResult` row created on inbound webhook | Yes | `labResultReadyWebhook`, `radiologyResultReadyWebhook` write the row + SSE if critical | ⚠️P — verify |
| Critical-value SSE broadcast | Yes | `subscribeToCriticalValues` + `broadcastCriticalValueAlert` | ✅ |

### 10c. Frontend

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| Critical-value alert banner (SSE consumer) | Yes | `src/app/services/critical-values-alert/*` — EventSource, auto-reconnect, sound | ⚠️P — **component not declared in app.module** (won't render) |
| Investigation results list view | Yes | ❌ missing | ❌ |
| Individual result detail view (lab/radiology) | Yes | ❌ | ❌ |
| Critical thresholds configuration UI | Nice-to-have | ❌ | 🗑️ — can defer |

---

## Module 11 — Follow-up Automation & Discharge PDF

### 11a. Backend

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| `follow-up-automation.ts` daily 8am cron | Yes | Present | ⚠️P — verify it actually creates Appointment rows and sends SMS |
| `discharge-pdf-generator.ts` | Yes | Present, used by `downloadDischargePDF` | ⚠️P — verify output matches branding; needs visual check |
| WhatsApp/SMS discharge summary push to patient | Plan | Existing `whatsapp-bot`/`sms` modules exist; integration not confirmed | ⚠️P |

### 11b. Frontend

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| "Download discharge PDF" action | Yes | Depends on discharge UI (❌ missing in frontend) | ❌ |
| Follow-up list / pending reminders admin view | Plan hints at `GET /api/follow-ups/pending` | ❌ | ⚠️P |

---

## Module 12 — Cross-cutting backend concerns

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| TS `Request` augmentation (type-safe `req.user`) | Implied by TS-strict rule | Missing — 40+ `(req as any)` casts | ❌ |
| Tests for each endpoint touched (happy + failure) | Briefing requires | **Zero tests** | ❌ |
| `env` loading with `HMIS_API_BASE_URL`, `HMIS_API_KEY` | Implied | Referenced in code; verify `.env.example` | ⚠️P |
| Rate limiting on webhooks | Security hardening | Not observed | ⚠️P |
| Webhook signature verification (HMAC) | Security | Not observed | ⚠️P |
| Nodemon / dev tooling | Existing | Unchecked | ✅ |

---

## Module 13 — Cross-cutting frontend concerns

| Artifact | Required | Currently exists? | Status |
|---|---|---|---|
| Global theme tokens (CSS vars: colors, spacing, typography) | Plan implies consistent Figma-sourced design | Hardcoded colors per component, no `theme.css` | ❌ |
| Shared component library (`shared/` or `common/`) | Recommended | Components co-located with features; PrimeNG reused | ⚠️P |
| Critical-values banner registered globally | Required for SSE alerts to actually show | Component exists; **not in `app.module` declarations** | ❌ |
| Loading / empty / error states | Required | Mostly present via PrimeNG `MessageService` + boolean flags | ⚠️P — verify per screen during Phase B |
| HTTP 401/403 redirect on auth expiry | Reasonable | Not observed | ⚠️P |
| Unit tests / `.spec.ts` in critical paths | Reasonable | None in HMIS paths | ❌ |

---

## Module 14 — Figma parity (all modules)

🚫 **BLOCKED for all screens.** Figma URL requires an authenticated session; no MCP tool available to this agent. Blocks Step 6 (Figma parity check) of every module in Phase B.

**Decision needed:** user exports Figma frames to the repo (e.g., `docs/figma/<module>/*.png`), or installs a Figma MCP server that can authenticate, or shares a view-only link.

---

## Summary Counts

| Status | Count | Meaning |
|---|---|---|
| ✅ EXISTS_AND_CORRECT | ~35 | No action |
| ⚠️P EXISTS_BUT_INCOMPLETE | ~30 | Patch in Phase B (add HMIS push, add audit log, verify behavior) |
| ⚠️W EXISTS_BUT_WRONG | ~15 | Consider refactor (path/field-name divergences); many are low-risk and can be mapped at boundary |
| ❌ MISSING | ~22 | Create: frontend IPD progress-note/discharge/pharmacy, MLC forms, LAMA/DAMA forms, conversion buttons, investigation results viewer, tests |
| 🗑️ EXTRA | ~5 categories | Flag for user: keep or remove (dashboard endpoints, stray routes, extra admin tools) |
| 🚫 BLOCKED | 1 (Figma) | User action required |

## Biggest Risks

1. **HMIS push on IPD admission / discharge / transfer / pharmacy ops is missing.** This is the whole point of Phase 2-3. Must be addressed in Sprint-3 module patches.
2. **Zero tests** make verification gates hollow. Tests must be written alongside each module patch.
3. **Frontend IPD care workflow is 0% built** (progress notes, discharge, pharmacy). Roughly 2-3 weeks of UI work.
4. **Figma is inaccessible.** Either unblock or accept we build without per-pixel parity in Phase B.
5. **Plan/schema contradiction on `hmisUhid`.** Needs a call before any migration is run.
