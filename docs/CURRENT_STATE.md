# CURRENT_STATE.md — Docminds HMIS Integration

Audit date: 2026-04-18
Audit scope: Backend (`Hospital-Admin-Panel-Backend`) + Frontend (`Hospital-Admin-Panel`, Angular 18) + Plan (`HMIS_Integration_Plan.html`)

This document inventories **what already exists** after the prior (clumsy) implementation run. No code was modified. Findings are verified against files, not self-report docs.

---

## 1. Repository Layout

```
e:/Docminds/
├── Backend/
│   ├── HMIS_Integration_Plan.html          ← the plan we are building to
│   └── Hospital-Admin-Panel-Backend/       ← Node.js + TypeScript + Express + Prisma + MySQL
│       ├── prisma/schema.prisma
│       ├── prisma/migrations/              ← 155 migrations applied (3 HMIS-related)
│       ├── src/api/                        ← 34 module folders
│       ├── src/index.ts                    ← route registration entry
│       ├── COMPLETE_IMPLEMENTATION_SUMMARY.md   ← prior-run self-report (cannot trust)
│       ├── PHASE2_IMPLEMENTATION_SUMMARY.md     ← prior-run self-report
│       ├── PHASE3_IMPLEMENTATION_GUIDE.md       ← prior-run self-report
│       └── INTEGRATION_TEST_GUIDE.md            ← prior-run manual test script
└── Frontend/
    └── Hospital-Admin-Panel/                ← Angular 18.2 + Angular Material + PrimeNG 17
        ├── src/app/                         ← 30+ feature folders
        └── src/app/app-routing.module.ts
```

Primary working directory is the Backend folder. Frontend sits alongside.

---

## 2. Prior-Run Self-Report Claims vs. Reality

The three markdown summaries in the backend root (written by the previous run) claim:

- 15 new Prisma models added
- 70+ API endpoints added
- 4 cron jobs
- All 13 NABH standards met

**Partial truths. Verified findings:**

| Claim | Verified fact |
|---|---|
| 15 new HMIS-related Prisma models | **14 core HMIS models present** (7 IPD, 5 Emergency/Trauma, 2 Investigation/HMIS). Plus 2 older assessment models (`OPDAssessment`, `ERAssessment`). |
| 70+ new endpoints | **Backend registers ~160 routes** across emergency/mlc/lama-dama/ipd/ipd-pharmacy/ward/hmis-sync/critical-values. All plan-required endpoints present; many extras too. |
| All HMIS push points wired | **FALSE.** Multiple critical push points missing (see §5). |
| All webhooks POST | **TRUE** — verified. |
| All NABH standards met | **Unverified.** No NABH audit tests exist. |
| Cron retry every 30 min | **TRUE** — matches code, but plan says **hourly**. Divergence from spec. |

---

## 3. Prisma Schema — Models Present

`prisma/schema.prisma` contains ~60 models. Focus is on HMIS-relevant ones.

### 3.1 Existing pre-HMIS models (relevant)

| Model | Status | Notes |
|---|---|---|
| `Patient` | exists | `prn: Int @unique`. **No `hmisUhid` field.** Plan text says "PRN = UHID" (same identifier) but Sprint 1 checklist says "Add hmisUhid to PatientDetails" — plan contradicts itself. |
| `PatientDetails` | exists | `prn: Int @unique`. No `hmisUhid`. |
| `Appointment` | exists | ✅ has `checkedIn: Boolean?` and `checkedInTime: DateTime?`. Matches plan. |
| `Prescription`, `Tablet`, `Allergy` | exists | OPD prescription chain, pre-existing. |
| `InvestigationOrder`, `Lab`, `Radiology` | exists | OPD investigation chain, pre-existing. |
| `OPDAssessment` | exists | Pre-existing OPD form model. |
| `ERAssessment` | exists | Pre-existing ER form model (separate from new `Emergency` model — overlap concern). |

### 3.2 New HMIS models (added by prior run)

**Emergency / Trauma module** (migration `20260415202450_add_emergency_trauma_modules`):

| Model | Status | Notable fields / divergences from plan |
|---|---|---|
| `Emergency` | ✅ present | Named `Emergency`, not `EmergencyCase`. Has `prn @unique`, `triageCategory`, `abcdeAssessment`, `traumaScore`, vitals, `status`. Relations to progress notes, MLC, LAMA, DAMA. |
| `EmergencyProgressNote` | ✅ present | SOAP-like: `observation`, vitals, `doctorName`. |
| `MlcCase` | ⚠️ partial | Present; **field-name divergences:** `fir_No` (plan: `firNumber`), `firstExaminationDone` (plan: `firstExamination`), `photographsTaken` + `photoUrls` (plan: `photos`), `samplesCollected` + `sampleStorageInfo` (plan: `samples`), `followUpExams` + `finalReport` (plan: `reports`). |
| `LamaRecord` | ⚠️ partial | Missing `hmisPushed: Boolean` field that plan enumerates. Field `reasonForLama` (plan: `patientReason`). |
| `DamaRecord` | ⚠️ partial | Missing `hmisPushed: Boolean` field. Fields `doctorRecommendation` (plan: `doctorAdvice`), `followUpAdvice` (plan: `followUpDoctor`). |

**HMIS / Investigation module** (migration `20260415203331_add_hmis_and_investigation_models`):

| Model | Status | Notes |
|---|---|---|
| `HmisAuditLog` | ✅ present | Matches plan exactly (`direction`, `module`, `action`, `payload LongText`, `response LongText?`, `status`, `retryCount`). |
| `InvestigationResult` | ✅ present | Matches plan exactly (orderId, prn, testName, department, result LongText, criticalFlag, reportUrl, hmisResultId, status). |

**IPD module** (migration `20260415204237_add_ipd_models`):

| Model | Status | Notes |
|---|---|---|
| `IpdWard` | ✅ present | Matches plan. |
| `IpdBed` | ⚠️ minor | Field named `hmisBedrId` (typo vs. `hmisBedId`). Has `@@unique([wardId, bedNumber])`. |
| `IpdAdmission` | ⚠️ divergent | Uses `sourceModule: String` + `referralOpdId` + `referralEmergencyId` + `referralMlcId` instead of plan's `referredFromOPD: Boolean` + `referredFromER: Boolean`. Arguably more flexible but divergent. No `hmisUhid` field (plan contradicts itself on this). |
| `IpdProgressNote` | ✅ present | Matches plan exactly (SOAP + vitals). |
| `IpdDischarge` | ⚠️ partial | `medications: String @db.LongText` — plan says JSON array. Currently stores JSON-encoded string, not a typed JSON column. Missing `doctorSignature` field (plan: MRD.3 compliance). |
| `IpdPrescription` | ✅ present | Matches plan (isCarryOver, carryOverFrom, status active/paused/discontinued). |
| `IpdMedicationLog` | ✅ present | MAR model, matches plan. |

### 3.3 Migration history (HMIS-related)

Three migrations added on 2026-04-15:

```
20260415202450_add_emergency_trauma_modules
20260415203331_add_hmis_and_investigation_models
20260415204237_add_ipd_models
```

These should not be re-run or duplicated. Any schema adjustments go into new additive migrations.

---

## 4. Backend API Modules

### 4.1 Module folders under `src/api/`

All 34 module folders enumerated. HMIS-relevant ones:

```
src/api/emergency/              ← new, present
src/api/mlc/                    ← new, present
src/api/lama-dama/              ← new, present
src/api/ipd/                    ← new, present (ipd.*, ipd-prescription.*, ward-management.*)
src/api/hmis-sync/              ← new, present (routes, controller, client, audit, queue, critical-values)
src/api/conversion/             ← new, present (opd-to-ipd.ts, emergency-to-ipd.ts)
src/api/investigation/          ← pre-existing + investigation-sync.ts helper added
src/api/prescription/           ← pre-existing + prescription-sync.ts helper added
src/api/patient/                ← pre-existing + sync hook added in controller
src/api/opd/                    ← pre-existing + admit-to-ipd endpoint added
src/api/appointments/           ← pre-existing + checkin handler
src/api/er/                     ← pre-existing (separate from new emergency/)
```

Other module folders present but outside plan scope: `appointments`, `ad`, `callback`, `channel`, `department`, `doctor`, `doctor-notes`, `email`, `estimation`, `extraslots`, `history-notes`, `login`, `mhc-checkin`, `radiology-queue`, `screenshot`, `service-radiology`, `services`, `sms`, `therapy`, `upload`, `voiceOPD`, `whatsapp`, `whatsapp-bot`.

### 4.2 `src/index.ts` registrations (HMIS-related)

All required route groups are wired:

```
/api/emergency          → emergencyRoutes        (line 99)
/api/mlc                → mlcRoutes              (line 100)
/api/lama-dama          → lamaDamaRoutes         (line 101)
/api/hmis-sync          → hmisSyncRoutes         (line 102)
/api/ipd                → ipdRoutes              (line 103)
/api/ipd-pharmacy       → ipdPrescriptionRoutes  (line 104)
/api/ward               → wardManagementRoutes   (line 105)
/api/critical-values    → criticalValuesRoutes   (line 106)
/api/opd                → opdRoutes
/api/appointments       → appointmentRoutes
/api/investigation      → investigationRoutes
/api/prescription       → prescriptionRoutes
/api/patients           → patientRoutes
```

Background services invoked at startup: `hmisSyncQueue.initializePollingJobs()`, `initializeFollowUpReminders()`.

### 4.3 Endpoints per module (summary)

Full verbose listing lives in the gap-analysis detail; headline counts:

| Module | Plan-required | Registered | All required present? |
|---|---|---|---|
| Emergency | 6 | 11 | ✅ yes (+5 extras) |
| MLC | 6 | 23 | ✅ yes (+17 extras: uploads, PDFs, history) |
| LAMA-DAMA | 3 | 26 | ✅ yes (+23 extras) |
| IPD core | 12 | 11 | ⚠️ "POST /api/ipd/progress-note" path is nested under `/admission/:id/progress-note` (divergent from plan's top-level path) |
| IPD pharmacy | 7 | 17 | ✅ yes (+10 extras) |
| Ward management | plan implicit | 21 | ✅ (plan only lists wards + bed status; 21 supplementary) |
| HMIS inbound webhooks | 6 | 6 | ✅ all POST, correct |
| HMIS outbound utilities | — | 22 | admin/manual trigger endpoints (extras) |
| Critical values / SSE | 1 stream | 11 | ✅ SSE stream present |
| Investigation | 1 | 5 | ✅ |
| Prescription | 1 | 12 | ✅ |
| Patient | 1 | 7 | ✅ |
| OPD | 1 (admit-to-ipd) | 6 | ✅ |
| Appointments | 1 (checkin) | 37 | ✅ |

### 4.4 Cron jobs (`hmis-sync.queue.ts`)

| Job | Schedule in code | Plan spec | Match? |
|---|---|---|---|
| Poll lab results | `*/5 * * * *` | every 5 min | ✅ |
| Poll radiology results | `*/5 * * * *` | every 5 min | ✅ |
| Sync bed availability | `*/15 * * * *` | every 15 min | ✅ |
| Retry failed syncs | `*/30 * * * *` | **hourly** (`0 * * * *`) | ⚠️ **divergent** |
| Follow-up reminders | daily 8am | — | extra |

---

## 5. HMIS Push + Audit-Log Coverage (critical)

The plan requires: every outbound HMIS push AND every inbound webhook must write an `HmisAuditLog` row (success AND failure). Actual coverage:

| Operation | HMIS push? | Audit log? |
|---|---|---|
| `patient.createPatient` | ✅ `syncPatientToHmis` | ✅ success + failure |
| `prescription.createPrescription` | ✅ `syncPrescriptionToHmis` | ✅ |
| `investigation.createInvestigationOrder` | ✅ `syncInvestigationOrderToHmis` | ✅ |
| `emergency.createEmergency` | ✅ `pushEmergencyToHmis` | ✅ |
| `emergency.updateEmergencyStatus` | ? | ✅ |
| `emergency.addProgressNote` | ❌ | ❌ |
| `emergency.convertToIPD` (via conversion helper) | ✅ | ✅ |
| `mlc.registerMlcCase` | ❌ no direct push function exists | ✅ |
| `mlc.recordExamination / samples / report` | ❌ | ✅ |
| `mlc.upload* / close*` | ❌ | ❌ |
| `lama-dama.create*` | ❌ no push | ✅ |
| `lama-dama.update* / upload*` | ❌ | ❌ |
| `ipd.createIpdAdmission` | ❌ **missing** | ❌ **missing** |
| `ipd.updateIpdAdmission` | ❌ | ❌ |
| `ipd.addProgressNote` | ❌ | ❌ |
| `ipd.createDischarge` | ❌ (only logs, no push) | ✅ |
| `ipd.transferPatient` | ❌ | ❌ |
| `ipd-pharmacy.continue / modify / discontinue / administer / skip` | ❌ | ❌ |
| `hmis-sync/webhooks/*` (6 inbound) | n/a | ✅ all 6 log |

**Summary: audit coverage is ~50% of required points. HMIS push is missing for IPD admission, IPD discharge, IPD transfer, IPD pharmacy operations, MLC, LAMA, DAMA.** These are not small gaps — they are the core integration points.

---

## 6. TypeScript Strictness Violations

Prior run widely used `(req as any).user?.username` instead of augmenting Express `Request`. Occurrences observed:

- `emergency.controller.ts`: ≥4 instances
- `mlc.controller.ts`: ≥8 instances
- `lama-dama.controller.ts`: ≥6 instances + casts to `any` in PDF/verification handlers
- `ipd.controller.ts`: ≥6 instances
- `ipd-prescription.controller.ts`: ≥8 instances

Total: 40+ occurrences. Violates the "no `any`" rule in the briefing.

---

## 7. Frontend (Angular 18.2)

### 7.1 Stack

- Angular 18.2.0
- Angular Material 18.2.6
- PrimeNG 17.18.11 + PrimeFlex + PrimeIcons
- chart.js, echarts, pdfmake, jsPDF, html2canvas, exceljs, luxon, signature_pad, ngx-signaturepad
- SSR available (`@angular/ssr`)
- State: RxJS BehaviorSubjects (no NgRx)
- AuthInterceptor in place
- **No global theme tokens.** Colors hardcoded per component (`#2563eb`, `#dc2626`, `#10b981`). Font: "Kanit".

### 7.2 Routes (HMIS-related) in `app-routing.module.ts`

```
/emergency       → EmergencyOverviewComponent         ✅
/ipd             → IpdOverviewComponent               ✅
/ward-census     → WardCensusComponent                ✅
/mlc             → MlcCasesComponent                  ✅
/lama-dama       → LamaDamaComponent                  ✅
/hmis-sync       → SyncStatusComponent                ✅
/opd             → OpdAssessmentComponent             ✅
/er              → ErOverviewComponent                ✅
```

No child routes for sub-screens; navigation done programmatically via `router.navigate`.

### 7.3 Screen completeness

| Module | Status | Notes |
|---|---|---|
| Patient register / list | ✅ exists | Real backend calls, PrimeNG table. |
| OPD assessment + Rx + Investigation | ✅ exists | Full form + PDF export + signatures. No dedicated results viewer. |
| Emergency overview / intake / list | ⚠️ partial | Intake form, queue, stats done. **Progress-notes form missing.** **"Admit to IPD" button not wired.** |
| MLC | ⚠️ 25% | List + filters only. **Registration, examination, samples, report forms all MISSING.** |
| LAMA/DAMA | ⚠️ 50% | List + stats. **Create form with signature capture MISSING.** |
| IPD admission | ✅ exists | Full form, ward/bed selection, source module. |
| IPD progress notes | ❌ missing | Service has interface but **no HTTP methods + no component.** |
| IPD discharge + PDF | ❌ missing | Service has interface but **no HTTP methods + no component.** |
| IPD pharmacy (carryover, continue/modify/discontinue, MAR) | ❌ missing | Service methods exist; **zero UI components.** |
| Ward / bed census | ✅ exists | Auto-refresh, export CSV, occupancy charts. |
| Investigation results viewer | ❌ missing | No list/detail component. |
| Critical-value SSE banner | ✅ functional | EventSource + auto-reconnect + severity colors + sound. **Not declared in `app.module`** — needs wiring. |
| HMIS audit-log viewer | ✅ exists | Full admin panel with retry + CSV export. |

### 7.4 Service layer

All eight core HMIS services exist under `src/app/services/`:
`emergency.service.ts`, `ipd.service.ts`, `ipd-prescription.service.ts`, `mlc.service.ts`, `lama-dama.service.ts`, `ward-management.service.ts`, `critical-values.service.ts`, `hmis-sync.service.ts`.

Gaps in services:
- `ipd.service.ts` — has `IpdProgressNote` / `IpdDischarge` interfaces but **no HTTP methods** for create/read/update.
- No dedicated `investigation-results.service.ts`.

### 7.5 Extra frontend modules (not in HMIS plan)

Present in routing; not blocking HMIS work: Therapy, Therapists, Nursing vitals, Radiology services, Lab consultations, Estimation, Blood donation (Samraksha), Appointments (large), Doctors.

---

## 8. Figma Design Access

**BLOCKED.** The Figma URL
`https://www.figma.com/design/S2gYoiH41ihtLjxcAUoYHq/Invention-Minds-LLP?node-id=9142-187&p=f&m=dev`
returned empty content via `WebFetch` — the page requires an authenticated Figma session. No Figma MCP tool is available in this environment.

Until resolved we cannot perform per-screen parity checks. **User action required:** either (a) share Figma frame exports as images in the repo, (b) install a Figma MCP server, or (c) enable a public/view-only link.

---

## 9. Environment & Tooling

- OS: Windows 11, shell bash
- Node/Prisma: `prisma@^5.0.0` per package.json references
- No CI config found in backend root; migrations run manually
- `.env` expected with `HMIS_API_BASE_URL`, `HMIS_API_KEY` (per prior-run docs)
- Uploads stored under `uploads/` (signatures, PDFs, photos)
- Tests: no `.spec.ts` files detected in HMIS paths — prior run created **zero tests** despite briefing requirement

---

## 10. Key Takeaways Before Phase B

1. **Schema is ~90% right.** Additive patches needed: `hmisPushed` on LAMA/DAMA, discharge `doctorSignature`, clarify `IpdDischarge.medications` (keep String LongText + validate JSON vs. switch to `Json`). Field renames (`fir_No`, `reasonForLama`, `hmisBedrId`, etc.) should be weighed: rename-migrations are risky with existing data and may not be worth it if payload shape to HMIS can map instead.
2. **Routes are all registered.** Plan-required endpoints exist.
3. **HMIS push + audit wiring is the biggest backend gap.** IPD admission/discharge/transfer, IPD pharmacy ops, MLC, LAMA, DAMA all miss either the push call, the audit log, or both.
4. **Cron retry schedule diverges** from plan (30min vs. hourly) — trivial to fix.
5. **TypeScript strict mode is violated** in 40+ places. Needs `Request` type augmentation file.
6. **Frontend is the biggest gap:** IPD progress notes, IPD discharge, IPD pharmacy/MAR, MLC forms (4), LAMA/DAMA create form, Emergency progress-note UI, Investigation results viewer. The critical-values banner exists but isn't registered in the app module.
7. **Figma is blocked** — parity checks cannot start until exports arrive.
8. **Zero automated tests exist** for HMIS modules — a verification gap the briefing calls out.
9. **Prior-run summary docs in the backend root are not authoritative.** Treat them as rough intent, not truth.
