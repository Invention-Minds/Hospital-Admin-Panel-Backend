# Admit-to-IPD Step 0 Audit (Pre-Sprint-3f)

**Date:** 2026-04-19 · **Scope:** Read-only audit. No code changes. Purpose: determine where the "Admit to IPD" button goes, whether an admission form already exists, and whether the backend is ready.

**Follows:** [estimation-ot-ipd-discovery.md](../audits/estimation-ot-ipd-discovery.md) — Option A approved (direct admission, no estimation gate).

---

## TL;DR

**Major finding:** An `IpdAdmissionComponent` exists at [src/app/ipd/ipd-admission/](../../../Frontend/Hospital-Admin-Panel/src/app/ipd/ipd-admission/) but is **orphaned** — not declared in `AppModule`, not routed in `AppRoutingModule`. Two places in the existing UI already try to navigate to `/ipd/admission` ([ipd-overview.component.ts:89,93](../../../Frontend/Hospital-Admin-Panel/src/app/ipd/ipd-overview.component.ts)) and to `/emergency/:id/convert-to-ipd` ([emergency-list.component.ts:121](../../../Frontend/Hospital-Admin-Panel/src/app/emergency/emergency-list/emergency-list.component.ts)), both of which fail silently (404).

**Second major finding:** There are **three** backend admission-creation paths, not one:

| Path | Who calls it | Carry-forward logic? |
|---|---|---|
| `POST /api/ipd/admission` | Generic — `IpdService.createAdmission` | No. Stores referral IDs as strings; pushes to HMIS. |
| `POST /api/opd/admit-to-ipd` | OPD-specific — not yet called from frontend | Yes. Calls `convertOpdToIpd()` helper (prescription carry-forward, investigation carry-forward). |
| `POST /api/emergency/:id/convert-to-ipd` | Emergency-specific — frontend has a stub calling it | Yes. Calls `convertEmergencyToIpd()` helper (MLC linkage, prescription carry-forward). |

Sprint 1 wired the conversion helpers but they have never been exercised end-to-end from the UI. Which endpoint the Admit button targets is a load-bearing design decision.

**Third major finding:** OPD assessment is not a routed page — it's a modal inside [today-consultations.component.html:210-215](../../../Frontend/Hospital-Admin-Panel/src/app/doctor-role/today-consultations/today-consultations/today-consultations.component.html). That changes the button placement conversation slightly.

**Backend is ready.** All three endpoints accept `sourceModule` + referral IDs, push to HMIS via `pushIpdAdmission` wrapped through Sprint 2f's audit-logging wrapper. Sprint 2a's test suite covers the generic endpoint's happy-path and failure-path with HMIS audit log assertions. Conversion-helper endpoints are not backed by integration tests against the UI path.

---

## 0.1 OPD screen — location, shape, and actions

**Primary file:** [src/app/assessment/opd-assessment/opd-assessment.component.ts](../../../Frontend/Hospital-Admin-Panel/src/app/assessment/opd-assessment/opd-assessment.component.ts) (892 lines) with matching `.html` (291 lines) and `.css` (299 lines).

**How it's surfaced:** not a routed page. Mounted as a modal body inside [today-consultations.component.html:210-215](../../../Frontend/Hospital-Admin-Panel/src/app/doctor-role/today-consultations/today-consultations/today-consultations.component.html) via `<app-opd-assessment [appointmentId]="..." (saved)="..." (close)="..." />`. The `/opd` route in app-routing renders `OpdAssessmentComponent` directly for standalone use but the operational entry is the Today Consultations modal.

**Sections** (template):
1. Patient Info (name, age, gender, UHID, height, weight, consultant, department, date, time)
2. Vitals (HR, RR, pulse, BP, temp, SpO2)
3. Nutritional Assessment (diet, enteral, allergies, NPO)
4. Pain Score (0 / 1–3 / 4–7 / 8–10)
5. Voice Assessment & Results (History, Examination, Investigation, Treatment Plan — populated via voice-to-text)
6. Screening (other screening, counselling on implants)
7. Staff Details (name, empId)
8. Doctor (name, KMC)

**Existing action buttons** ([opd-assessment.component.html:286-290](../../../Frontend/Hospital-Admin-Panel/src/app/assessment/opd-assessment/opd-assessment.component.html)):
```html
<div class="buttons">
  <button type="submit" [disabled]="isSubmitting" class="save-button">Submit</button>
  <button type="button" class="print-button" (click)="printAssessment()">Print</button>
</div>
```

**Button group pattern:** flex, centered, 10px gap. `.save-button` is green `#169458` (hardcoded hex — legacy, pre-token); `.print-button` is dark navy `#0e2970`. Buttons are 150px × 7px·14px, Kanit font, 20px. **No admit stub exists** (no commented-out `admitToIpd` method, no hidden button).

**Pre-fill data available in component state** (mapped to `IpdAdmission` fields):

| IpdAdmission target | OPD source | Confidence |
|---|---|---|
| `prn` | `formData.uhid` (pulled from `appointment.prnNumber`) | ✅ reliable |
| `sourceModule` | hardcode `'opd'` | ✅ |
| `referralOpdId` | `@Input appointmentId` (or `formData.appointmentId`) | ✅ |
| `referringDoctor` | `formData.consultant` | ✅ |
| `admittingDoctor` | `formData.doctorName` (usually same as consultant) | ✅ |
| `department` | `formData.department` | ✅ |
| `diagnosis` | `formData.treatmentPlan` + `formData.investigation` (voice-captured) | ⚠️ verbose; user probably wants to re-edit |
| `admissionType` | — | ❌ must pick — elective / emergency / transfer |
| `wardId`, `bedId`, `roomType` | — | ❌ not available in OPD; must pick in modal/form |

**OPD save flow:** `submitForm()` at [line 319-350](../../../Frontend/Hospital-Admin-Panel/src/app/assessment/opd-assessment/opd-assessment.component.ts) calls `opdService.saveAssessment` / `updateAssessment`, toasts success via `MessageService`, emits `saved` + `close` events to the parent modal. **Does not navigate.** The modal closes when the parent wraps up.

**Guards:** no `canDeactivate` guard on this component.

**MessageService:** already injected and used for toasts.

---

## 0.2 Emergency screens — there are two, and it matters

**Two parallel emergency modules** exist, from different eras. Verify which gets the Admit button.

### 0.2a The HMIS-aware Emergency module (built in Sprint 1–2f)

Location: [src/app/emergency/](../../../Frontend/Hospital-Admin-Panel/src/app/emergency/). Components:

| Component | File | Purpose |
|---|---|---|
| `EmergencyOverviewComponent` | `emergency-overview.component.ts` | Dashboard with stats (arrived / stabilized / admitted-ipd / LAMA / DAMA / discharged) |
| `EmergencyIntakeComponent` | `emergency-intake/emergency-intake.component.ts` | Create emergency case (PRN, triage, ABCDE, vitals) |
| `EmergencyListComponent` | `emergency-list/emergency-list.component.ts` | Queue list with per-row "Convert to IPD" button |

**The route is `/emergency` → `EmergencyOverviewComponent`** ([app-routing.module.ts:92](../../../Frontend/Hospital-Admin-Panel/src/app/app-routing.module.ts)). This is the HMIS-integrated path and the one to wire for Sprint 3f.

**Existing "Convert to IPD" button** — already stubbed:

```html
<!-- emergency-list.component.html:106-110 -->
<button
  pButton pRipple type="button"
  pTooltip="Convert to IPD"
  icon="pi pi-arrow-right"
  class="p-button-rounded p-button-success p-button-sm"
  (click)="convertToIPD(row.id)"
  [disabled]="row.status === 'admitted-ipd'">
</button>
```

```ts
// emergency-list.component.ts:120-122
convertToIPD(caseId: string): void {
  this.router.navigate([`/emergency/${caseId}/convert-to-ipd`]);
}
```

**Dead navigation** — `/emergency/:id/convert-to-ipd` is not a route anywhere in `app-routing.module.ts`. Clicking the button today 404s silently (lands on `/login` via the catch-all).

**Emergency status model** already supports the post-admission state (`admitted-ipd`):
```ts
// emergency-list.component.ts:33-41
statusOptions = [
  { value: 'arrived' }, { value: 'stabilized' }, { value: 'referred' },
  { value: 'admitted-ipd' }, { value: 'LAMA' }, { value: 'DAMA' }, { value: 'discharged' }
];
```

Schema has `Emergency.status: String` with the same set of observed values.

**Existing service method** ([emergency.service.ts:87-89](../../../Frontend/Hospital-Admin-Panel/src/app/services/emergency.service.ts)):
```ts
convertToIPD(emergencyId: string, admissionData: any): Observable<any> {
  return this.http.post(`${this.apiUrl}/${emergencyId}/convert-to-ipd`, admissionData);
}
```
This method is defined but never called. It hits the real backend route (see §0.4).

### 0.2b The legacy ER Assessment module

Location: [src/app/assessment/er-*](../../../Frontend/Hospital-Admin-Panel/src/app/assessment/). Components: `ErOverviewComponent` (at `/er`), `ErAssessmentComponent`, `ErListComponent`. This is the older pre-HMIS ER assessment form with a `disposition` text field and no admission stub.

**Verdict:** for Sprint 3f, wire the HMIS-aware Emergency module (§0.2a). The legacy ER module is out of scope — it writes to a separate `assessment` table, not to `Emergency`, and has no HMIS integration. Touching it risks pulling Sprint 3.5's "legacy-cleanup" in.

### "Need admission" signal

Not a structured field. The emergency status model includes `admitted-ipd` as an achievable terminal state, but there's no pre-admission "needs admission" flag. The button is always visible in the list row (disabled only when status already equals `admitted-ipd` — current behaviour).

### Pre-fill data available

`EmergencyListComponent` has `row: any` per case, containing `id`, `prn`, `status`, `triageCategory`, `presentingComplaint`, `hmisEmergencyId`, etc. — enough to pre-fill `referralEmergencyId` (`row.id`) and `prn`. The full record fetch may be needed for diagnosis/doctor context.

---

## 0.3 IpdAdmission creation UX — form exists but is orphaned

### Component

[src/app/ipd/ipd-admission/ipd-admission.component.ts](../../../Frontend/Hospital-Admin-Panel/src/app/ipd/ipd-admission/ipd-admission.component.ts) — a reactive-forms component with this shape:

```ts
this.admissionForm = this.fb.group({
  prn:               ['', Validators.required],
  admissionDate:     [new Date(), Validators.required],
  admissionTime:     [<now>, Validators.required],
  admissionType:     ['', Validators.required],
  admittingDoctor:   ['', Validators.required],
  department:        ['', Validators.required],
  wardId:            ['', Validators.required],
  bedId:             ['', Validators.required],
  roomType:          ['', Validators.required],
  diagnosis:         ['', Validators.required],
  referringDoctor:   [''],
  sourceModule:      ['direct']     // ← hardcoded; doesn't read query params
});
```

Dropdowns: ward list (from `WardManagementService.getAllWards()`), bed list filtered by ward (`WardManagementService.getBedsByWard(wardId)` → only `available` beds), admission type (`elective / emergency / transfer`), room type (`general / semi-private / private / ICU / HDU`).

Submit path: `IpdService.createAdmission(formData)` → `POST /ipd/admission` (generic endpoint — see §0.4).

On success: toasts and navigates to `/ipd/:admissionId` (**also a non-existent route** — same orphan pattern; Sprint 2 built `/ipd` overview but not a detail route for a specific admission).

### Why it's orphaned

Confirmed via grep:
- `IpdAdmissionComponent` appears in **one** file: its own component definition. Not in `app.module.ts`, not in `app-routing.module.ts`.
- Two places navigate to `/ipd/admission` ([ipd-overview.component.ts:89,93](../../../Frontend/Hospital-Admin-Panel/src/app/ipd/ipd-overview.component.ts)) but the route isn't declared.

### Missing features for OPD/Emergency integration

- `sourceModule` is hardcoded `'direct'` — doesn't read query params.
- No `referralOpdId` / `referralEmergencyId` / `referralMlcId` fields in the form.
- No query-param pre-fill for `prn` / `admittingDoctor` / `department` / `diagnosis`.

---

## 0.4 Backend readiness

### Three admission-creation paths

**Path 1 — Generic `POST /api/ipd/admission`** ([ipd.routes.ts:34](../../../src/api/ipd/ipd.routes.ts) → [ipd.controller.ts:107-236](../../../src/api/ipd/ipd.controller.ts))

- Accepts: `prn` (required), `admissionType` (defaults `routine`), `sourceModule` (defaults `direct`), `referralOpdId`, `referralEmergencyId`, `referralMlcId`, `referringDoctor`, `admittingDoctor` (required), `department` (defaults `General`), `wardId` (required), `bedId` (required), `roomType` (defaults `general`), `diagnosis` (required).
- Generates `admissionNo` as `JMRH-IPD-####`.
- Marks bed `occupied`.
- Wraps HMIS push via Sprint 2f wrapper: calls `pushIpdAdmission(payload)` which posts to `/adt/admission`. Wrapper writes success **and** failure `HmisAuditLog` rows, stores `hmisAdmissionId` on success, returns 201 either way.
- **Does not call `convertOpdToIpd()` or `convertEmergencyToIpd()`.** Doesn't carry prescriptions or investigations forward even if `referralOpdId`/`referralEmergencyId` is set. The referral ID is stored as a loose string pointer (per the estimation-ot-ipd discovery audit) but no side-effects follow.
- **Sprint 2a tests** ([src/api/ipd/__tests__/ipd-admission.test.ts](../../../src/api/ipd/__tests__/ipd-admission.test.ts)) cover happy path + HMIS 503 failure + validation 400 + bed-occupancy 409. Fixture uses `sourceModule: 'direct'`. **No test exercises `sourceModule: 'opd'` + `referralOpdId` path** or the equivalent emergency path.

**Path 2 — OPD-specific `POST /api/opd/admit-to-ipd`** ([opd.routes.ts:17](../../../src/api/opd/opd.routes.ts) → [opd.controller.ts:108-153](../../../src/api/opd/opd.controller.ts))

- Accepts: `appointmentId` (required), `wardId` (required), `bedId` (required), `admittingDoctorId`, `admittingDoctorName` (required), `admissionType` (defaults `routine`).
- Calls `convertOpdToIpd(appointmentId, wardId, bedId, admittingDoctorId, admittingDoctorName, admissionType)` — the Sprint 1 helper at [src/api/conversion/opd-to-ipd.ts](../../../src/api/conversion/opd-to-ipd.ts).
- The helper:
  - Resolves `appointment` → `prn`, `doctor.name`, `department`, vitals.
  - Creates `IpdAdmission` with `sourceModule='opd'`, `referralOpdId=appointmentId`, pre-filled referringDoctor + department.
  - **Carries forward OPD prescriptions into `IpdPrescription` rows** (with `carryOverFrom='opd'`).
  - **Carries forward investigation orders** into IPD's investigation list.
  - Calls HMIS push on the new admission via the Sprint 2f wrapper.
- **No integration test coverage exists** for this endpoint. Sprint 1 migrated the helper but the UI has never driven it end-to-end.

**Path 3 — Emergency-specific `POST /api/emergency/:id/convert-to-ipd`** ([emergency.routes.ts:40](../../../src/api/emergency/emergency.routes.ts) → [emergency.controller.ts:502-556](../../../src/api/emergency/emergency.controller.ts))

- Accepts: `:id` (emergencyId in path), `wardId` (required), `bedId` (required), `admittingDoctorId`, `admittingDoctorName` (required), `admissionType` (defaults `emergency`).
- Calls `convertEmergencyToIpd(emergencyId, wardId, bedId, admittingDoctorId, admittingDoctorName, admissionType)` — the Sprint 1 helper at [src/api/conversion/emergency-to-ipd.ts](../../../src/api/conversion/emergency-to-ipd.ts).
- The helper:
  - Looks up the emergency + any `MlcCase` for it.
  - Creates `IpdAdmission` with `sourceModule='emergency'`, `referralEmergencyId=emergencyId`, `referralMlcId` if an MLC case exists, `roomType='ICU'` for red-triage or `'general'` otherwise, `diagnosis = emergency.presentingComplaint`.
  - Sets `emergency.status='admitted-ipd'`.
  - **Carries forward emergency prescriptions** into `IpdPrescription` rows.
  - Calls HMIS push via the wrapper.
- **No integration test coverage.** Same Sprint 1 / UI-never-drove-it situation.

### So which endpoint should Sprint 3f target?

| Option | What you get | What you lose |
|---|---|---|
| **1 — Generic** (`/api/ipd/admission`) | Simplest wiring. Reuses the orphaned `IpdAdmissionComponent` form. Has test coverage. | Prescription + investigation + MLC carry-forward **does not happen**. Sprint 1's conversion work remains unexercised. |
| **2 — Source-specific conversion endpoints** (`/opd/admit-to-ipd` + `/emergency/:id/convert-to-ipd`) | Carry-forward works. Exercises Sprint 1's helpers end-to-end. Frontend stubs (emergency-list.`convertToIPD`) already point at the Emergency path. | No existing tests for these endpoints. The `IpdAdmissionComponent` form can't directly submit to them (shape mismatch); either use it as a UI layer and dispatch inside the component, or build a lighter modal. |
| **3 — Hybrid** (form dispatches to source-specific endpoint based on `sourceModule`) | Both carry-forward works AND reuses the form. | Form needs conditional submit wiring + three service call paths. |

---

## 0.5 Existing conventions to reuse

- **P1 ConfirmDialog** ([shared/ui/confirm-dialog/](../../../Frontend/Hospital-Admin-Panel/src/app/shared/ui/confirm-dialog/)) for destructive/irreversible-ish confirms. Already used for LAMA/DAMA create (severity=danger), MLC close (warning). Admission is reversible via discharge, so **severity=warning** fits.
- **P2 PageHeader** ([shared/ui/page-header/](../../../Frontend/Hospital-Admin-Panel/src/app/shared/ui/page-header/)) — used on most Sprint 3c/3d/3e routed forms for title + subtitle + patient context. If the Admit flow goes to a routed form, use it.
- **PrimeNG Dropdown + Calendar** — already in use on the orphaned `IpdAdmissionComponent` form.
- **MessageService** — already wired in both OPD + Emergency components.

---

## 0.6 Recommended approach — proposal for user review

### Recommended: Option 2 (source-specific conversion endpoints) with a modal UI

**Rationale:**
1. **Honors Sprint 1's work.** Prescription/investigation/MLC carry-forward is why the conversion helpers exist. Using the generic endpoint makes that work dead-weight.
2. **The Emergency-list stub is already pointing at this path** (`emergency.service.ts:87-88` already posts to `/emergency/:id/convert-to-ipd`). Un-stubbing means collecting ward/bed/doctor + calling the existing service — fewer net changes than rerouting to a different endpoint.
3. **Emergency admissions skipping prescription carry-forward is a clinical harm.** If a trauma patient has pressor drips mid-administration in the Emergency prescription list, not carrying them forward to IPD is dangerous. This isn't a UX nicety — the helper is load-bearing.
4. **It exercises Sprint 1 end-to-end.** Risk flagged in the user's prompt ("may not have been exercised end-to-end") — Sprint 3f is the right moment to surface any latent bugs.

**UI shape:**
- **Shared modal component** — `AdmitToIpdModalComponent` in `src/app/shared/ui/admit-to-ipd-modal/` (feature-local if only OPD + Emergency use it, or shared if future callers are planned).
- Inputs: `context: { source: 'opd' | 'emergency'; sourceId: string; prefill?: { prn, diagnosis, admittingDoctor, department } }`.
- Form fields: Ward (dropdown), Bed (dropdown filtered by ward), Admitting doctor (dropdown or text), Admission type (elective/emergency/transfer — defaults to `emergency` for Emergency caller, `elective` for OPD caller), Diagnosis (pre-filled, editable).
- Submit: dispatches to `OpdService.admitToIpd()` (new method, to be added — backend path already exists) for OPD, or existing `EmergencyService.convertToIPD()` for Emergency.
- Confirm flow: P1 ConfirmDialog (severity=warning) — *"This will admit the patient to IPD, carrying forward active prescriptions and investigations. Continue?"*

**Placement:**
- **OPD:** "Admit to IPD" button in the `.buttons` flex group after Print, only enabled when `isEditMode && formData.id` is set (assessment must have been saved first so there's an `appointmentId` linkable). Opens the modal.
- **Emergency:** Un-stub the existing `convertToIPD` button in `EmergencyListComponent`. Replace the `this.router.navigate(…)` call with modal open. Disabled behaviour (`status === 'admitted-ipd'`) stays.

**What about the orphaned `IpdAdmissionComponent`?**
- **Leave it orphaned for Sprint 3f.** It was intended for a future "direct admission" flow (no OPD/Emergency trigger — e.g., a planned elective admission). That's Sprint 3g / Sprint 4 work.
- Add a note in `sprint-3-backlog.md` capturing its orphan status + intended purpose.

**Scope estimate:**
- 1 new shared modal component (~150 LOC + ~80 LOC styles).
- 1 new `OpdService.admitToIpd()` method.
- Button add in OPD (2 lines template + 1 method).
- Un-stub `EmergencyListComponent.convertToIPD` (modal open instead of navigate).
- Route registration for the admit modal is N/A if it's a `*ngIf` overlay rather than a routed page.
- Tests: service contract tests (Opd.admitToIpd, Emergency.convertToIPD) + modal component spec + patches to OPD and Emergency list component specs. ~10–14 tests.

### Alternative: Option 1 (generic form, navigate from OPD/Emergency)

Adopt if the user prefers a single admission form (matches the orphaned component's intent) and is willing to:
1. Register the route `/ipd/admission/new` in `app-routing.module.ts`.
2. Add `IpdAdmissionComponent` to `AppModule.declarations`.
3. Enhance the form's `ngOnInit` to read query params (`sourceModule`, `referralOpdId`, `referralEmergencyId`, `prn`, `admittingDoctor`, `department`, `diagnosis`) and pre-fill.
4. Explicitly accept that prescription/investigation/MLC carry-forward does not happen in Sprint 3f, and open a Sprint 4 ticket to either (a) teach `POST /api/ipd/admission` to invoke the conversion helpers when referral IDs are set, or (b) migrate callers to the dedicated endpoints later.

Scope estimate is smaller (~3 files, ~30 LOC diff) but the clinical-safety tradeoff is real.

### Not recommended: Option 3 (hybrid)

Form dispatches to different endpoints based on `sourceModule`. Too much conditional submit logic for the benefit; harder to test; muddles the form's purpose (is it creating a direct admission or orchestrating a conversion?). Avoid.

---

## 0.7 Confirmation UX

The user's lean in the prompt — *ConfirmDialog severity=warning with copy "This will create an IPD admission linked to this [OPD visit | Emergency case]. Continue?"* — is correct. Two refinements:

1. **Mention carry-forward** in the message if we go Option 2: *"This will admit the patient and carry forward their active prescriptions and investigations. Continue?"* — sets clinician expectation.
2. **Don't block bed-picker clarity with a confirm.** The modal should collect ward/bed/doctor first, then confirm on the submit button. (Current Sprint 3 pattern: confirm guards the submit, not the modal opening.)

---

## 0.8 Field mapping summary

### OPD → IPD pre-fill

| IpdAdmission field | OPD source | Note |
|---|---|---|
| `prn` | `formData.uhid` | Copy as-is |
| `admittingDoctor` | `formData.doctorName` | Editable in modal |
| `department` | `formData.department` | Copy as-is |
| `diagnosis` | `formData.treatmentPlan` ( + optional `formData.investigation`) | Editable; voice-captured text may be verbose |
| `referralOpdId` | `@Input appointmentId` | Conversion helper handles; modal just needs the ID |
| `sourceModule` | hardcode `'opd'` | Set by endpoint |
| `admissionType` | default `'elective'` | User can change |
| `wardId`, `bedId`, `roomType` | user picks in modal | Required |

### Emergency → IPD pre-fill

| IpdAdmission field | Emergency source | Note |
|---|---|---|
| `prn` | `row.prn` | Copy as-is |
| `admittingDoctor` | modal picks | User choice (Emergency caseload may not have a single attending) |
| `department` | default `'General'` | Conversion helper sets this |
| `diagnosis` | `row.presentingComplaint` (or full emergency fetch) | Editable; helper uses this as default |
| `referralEmergencyId` | `row.id` | Path parameter, not body |
| `referralMlcId` | helper auto-looks up from `MlcCase.emergencyId` | No UI plumbing needed |
| `sourceModule` | hardcode `'emergency'` | Set by endpoint |
| `admissionType` | default `'emergency'` | Per helper logic |
| `roomType` | `row.triageCategory === 'red' ? 'ICU' : 'general'` (default) | User can override |
| `wardId`, `bedId` | user picks in modal | Required |

---

## 0.9 Backend gaps flagged

None that block Sprint 3f. Minor items for later:

1. **No sourceModule-specific integration tests** for `POST /api/ipd/admission` (only `direct` exercised). Sprint 3.5 or 4 cleanup.
2. **No integration tests** for `POST /api/opd/admit-to-ipd` or `POST /api/emergency/:id/convert-to-ipd`. If Sprint 3f wires these, adding tests during 3f is the right moment — flag for inclusion in the 3f test plan.
3. **`IpdAdmissionComponent` navigates to `/ipd/:admissionId` on success** — that detail route doesn't exist. If Option 1 is picked, this must be either fixed (build the detail route) or changed (redirect to `/ipd` overview).
4. **`/emergency/:id/convert-to-ipd` frontend route is referenced but not declared** — dead navigation. Un-stubbing (Option 2) removes the issue; routing (never-planned variant) isn't needed.

---

## 0.10 Open questions for the user

1. **Option 1, 2, or 3?** Recommendation: **Option 2** (source-specific conversion endpoints + shared modal). See §0.6 rationale.

2. **If Option 2: where does the shared modal live?**
   - (a) `src/app/shared/ui/admit-to-ipd-modal/` — shared pattern (future direct-admission flow may also use it).
   - (b) Co-located `src/app/ipd/admit-to-ipd-modal/` — treats admission as an IPD-domain concern. Mirrors how LAMA/DAMA + MLC did it.
   - My lean: **(a) shared**. Two non-trivial callers at launch (OPD + Emergency) is the same "two use cases ⇒ extract" bar P6 HmisSyncIndicator used.

3. **OPD button placement — before or after save?**
   - Require save first (disable until `isEditMode && formData.id`) — clinically safer (assessment is on record before admission converts it), but forces users into a two-step flow.
   - Allow "Save & Admit" as a combined action — smoother, but failure modes (save fails, admit succeeds?) are harder to reason about.
   - My lean: **require save first**. Matches Sprint 3 convention of narrow, testable actions.

4. **Test plan size.** ~10–14 tests sounds right for Option 2. Confirm, or adjust?

5. **Should we leave `IpdAdmissionComponent` orphaned or delete it?**
   - Leave: preserves future direct-admission form.
   - Delete: removes dead code.
   - My lean: **leave**, with a note added to `sprint-3-backlog.md` — Sprint 3g / 4 will decide the direct-admission UX.

---

## Appendix — Verification log

- `IpdAdmissionComponent` found in exactly one file (its own definition) — confirmed orphan via `grep "IpdAdmissionComponent" src/app/`.
- `/ipd/admission` navigations in two places; `/emergency/:id/convert-to-ipd` navigation in one place — confirmed via `grep "'/ipd/admission\|'/emergency/.*convert"`.
- Three backend admission-creation endpoints: `/api/ipd/admission`, `/api/opd/admit-to-ipd`, `/api/emergency/:id/convert-to-ipd` — confirmed via `grep "convert-to-ipd\|admit-to-ipd"`.
- Conversion helpers: `convertOpdToIpd` at `src/api/conversion/opd-to-ipd.ts`, `convertEmergencyToIpd` at `src/api/conversion/emergency-to-ipd.ts` — read to confirm carry-forward behaviour.
- Sprint 2a test file: `src/api/ipd/__tests__/ipd-admission.test.ts` — reviewed via agent to confirm coverage scope.
- OPD assessment is modal-hosted — confirmed by the Today Consultations template `<app-opd-assessment>` usage.
- Emergency is dual-module (HMIS-aware `src/app/emergency/*` + legacy `src/app/assessment/er-*`) — confirmed via glob.

No DB queries. All findings are static.
