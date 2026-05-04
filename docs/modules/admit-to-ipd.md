# Sprint 3f — Admit-to-IPD Plan

**Date:** 2026-04-19 · **Builds on:** [estimation-ot-ipd-discovery.md](../audits/estimation-ot-ipd-discovery.md) (Option A approved — direct admission), [admit-to-ipd-audit.md](./admit-to-ipd-audit.md) (Step 0 findings, Option 2 approved — source-specific conversion endpoints + shared modal).

## 1. Goal

Wire the existing Sprint-1 OPD→IPD and Emergency→IPD conversion helpers to the UI. Surface an "Admit to IPD" action on the OPD assessment screen and un-stub the existing "Convert to IPD" button on the Emergency list. Both flows open a shared modal that collects ward/bed/admitting-doctor/admission-type, confirms via P1, and dispatches to the appropriate conversion endpoint.

No schema changes. No new backend endpoints. Frontend-first with targeted backend integration tests for the conversion helpers (first end-to-end exercise of Sprint 1's wrapper-migrated helpers).

## 2. Patterns composed

| Pattern | Purpose | From |
|---|---|---|
| §1 FORM | Modal body (ward/bed/doctor/type + context strip) | ui-patterns.md §1 |
| §3 MODAL 3a | Dialog shell (scrim + fixed centered panel) | ui-patterns.md §3 |
| §4 BUTTON | Submit primary + cancel secondary in modal footer; admit button on OPD/Emergency | ui-patterns.md §4 |
| P1 ConfirmDialog | Confirms submit (severity=warning) | ui-patterns.md P1 |
| P4 EmptyState | Shown inside ward/bed dropdowns when empty | ui-patterns.md P4 |
| **NEW P7 AdmitToIpdModal** | Shared bridge component surfaced from OPD + Emergency | This sprint |

## 3. Component architecture

### P7 AdmitToIpdModalComponent (new, shared)

- **Path:** `src/app/shared/ui/admit-to-ipd-modal/admit-to-ipd-modal.component.{ts,html,css,spec.ts}`
- **Selector:** `app-admit-to-ipd-modal`
- **Inputs:**
  - `visible: boolean` (two-way bindable)
  - `source: 'opd' | 'emergency'`
  - `context: AdmitContext | null` — `{ sourceId: string | number, prn?: string, patientName?: string | null, referringDoctor?: string | null, summary?: string | null, suggestedAdmissionType?: 'elective' | 'emergency' | 'transfer', suggestedRoomType?: string }`
- **Outputs:**
  - `visibleChange: EventEmitter<boolean>`
  - `admitted: EventEmitter<{ admissionId: string; admissionNo: string }>` — fired after successful create
  - `cancelled: EventEmitter<void>` — fired on close/cancel without submitting
- **Form shape** (FormBuilder):
  ```ts
  admitForm = fb.group({
    wardId: ['', Validators.required],
    bedId: ['', Validators.required],
    admittingDoctorId: [null],          // optional — surrounding doctor dropdown may not have a stable id
    admittingDoctorName: ['', Validators.required],
    admissionType: ['emergency', Validators.required],
  });
  ```
- **Ward + bed loading:** `WardManagementService.getAllWards()` on `visible` flipping to true; `getBedsByWard(wardId)` on ward change, filtered to `status === 'available'`.
- **Doctor dropdown:** `DoctorServiceService.getAllDoctors()`; pre-fills `admittingDoctorName` from `context.referringDoctor` when source === 'opd' (OPD consultant typically admits their own patient).
- **Admission type default:** `'emergency'` when `source === 'emergency'`; `'elective'` when `source === 'opd'`.
- **Submit flow:** validates form → opens P1 ConfirmDialog (severity=warning) → on confirm, dispatches to correct service method by `source`:
  - `'opd'` → `OpdService.admitToIpd({appointmentId, wardId, bedId, admittingDoctorId, admittingDoctorName, admissionType})`
  - `'emergency'` → `EmergencyService.convertToIPD(sourceId, {wardId, bedId, admittingDoctorId, admittingDoctorName, admissionType})`
- **Success:** PrimeNG `MessageService` success toast — *"Admission {admissionNo} created"* — emits `admitted` event with `{admissionId, admissionNo}`; modal closes.
- **Error:** error toast — modal stays open with form populated so user can retry or fix.

### 3b. OpdService (new method on existing service)

File: [src/app/services/opd-assessment/opd-assessments.service.ts](../../../Frontend/Hospital-Admin-Panel/src/app/services/opd-assessment/opd-assessments.service.ts). Adds:

```ts
admitToIpd(payload: {
  appointmentId: number;
  wardId: string;
  bedId: string;
  admittingDoctorId: number | null;
  admittingDoctorName: string;
  admissionType: 'elective' | 'emergency' | 'transfer' | 'routine';
}): Observable<AdmitToIpdResponse> {
  return this.http.post<AdmitToIpdResponse>(`${this.apiUrl}/admit-to-ipd`, payload);
}
```

Where `AdmitToIpdResponse = { message: string; data: { ipdAdmission: IpdAdmission; pendingPrescriptions: unknown[]; pendingInvestigations: unknown[] } }` (matches the conversion helper's return shape).

Existing `EmergencyService.convertToIPD(emergencyId, admissionData)` is already defined and calls `POST /emergency/:id/convert-to-ipd` — no change needed.

### 3c. OPD component patch ([opd-assessment.component.*](../../../Frontend/Hospital-Admin-Panel/src/app/assessment/opd-assessment/))

- Add "Admit to IPD" button to the existing `.buttons` action group, after Print.
- Button is disabled until `isEditMode && !!formData.id` — i.e., the assessment has been persisted and has an id.
- Tooltip on hover: *"Save assessment first"* when disabled. `pTooltip` directive.
- `submitForm()` success handler **sets** `this.formData.id = res?.id ?? res?.data?.id` and `this.isEditMode = true` after create so the button enables without navigating away.
- Click opens `<app-admit-to-ipd-modal [visible]="..." source="opd" [context]="...">` embedded in the OPD template.
- Modal `admitted` handler shows success toast and closes the OPD modal via `this.close.emit()` so the parent (TodayConsultations) returns to the consultation list.

### 3d. Emergency list patch ([emergency-list.component.*](../../../Frontend/Hospital-Admin-Panel/src/app/emergency/emergency-list/))

- Replace `convertToIPD(caseId)` body: instead of `router.navigate([...])`, set `this.admitModalVisible = true; this.admitContext = { sourceId: caseId, ... }`.
- Add the modal to the template: `<app-admit-to-ipd-modal [(visible)]="admitModalVisible" source="emergency" [context]="admitContext" (admitted)="onAdmitted($event)">`.
- `onAdmitted()` reloads the list (so status badge flips to `admitted-ipd`) and toasts success.
- Button's existing `[disabled]="row.status === 'admitted-ipd'"` stays — no-change good UX.

## 4. Reusables used vs. new

- **P1** ConfirmDialog — severity=`'warning'`.
- **P4** EmptyState — for the rare case a ward or bed dropdown is empty (no beds in the system / no available beds in ward).
- **New P7** AdmitToIpdModal — see §3 above. Goes into ui-patterns.md.

## 5. NABH compliance

- **ACC.3 (Admission Process)** — admission is created through a structured form that captures ward, bed, admitting doctor, and type. HMIS push via `pushIpdAdmission` provides regulatory traceability.
- **ACC.4 (Continuity of Care)** — the source link (`referralOpdId` / `referralEmergencyId` / `referralMlcId`) is preserved in the admission record. Pending prescriptions + investigations are returned in the response so the IPD Pharmacy review step (Sprint 3c) can continue active medications.

## 6. Design decisions + flagged limitations

### 6a. Modal captures only what the helpers accept

The Sprint 1 conversion helpers take 6 params: `appointmentId`/`emergencyId`, `wardId`, `bedId`, `admittingDoctorId`, `admittingDoctorName`, `admissionType`. The modal surfaces exactly these. Diagnosis, room type, and department are NOT editable in the modal — the helpers fill them from the source (OPD: *"OPD Referral from {doctorName}"* generic placeholder; Emergency: `presentingComplaint`; room type: `'general'` for OPD, `'ICU'` for red-triage Emergency).

**Flagged limitation:** OPD diagnosis is generic. Clinicians will need to update the admission's diagnosis via the first IPD Progress Note (Sprint 3a-2) rather than editing admission itself. Acceptable for Sprint 3f; backlog entry added to consider extending the helper to accept a `diagnosis` param.

### 6b. No ConfirmDialog on modal OPEN, only on SUBMIT

Opening the modal is reversible (cancel/X/scrim close). Submitting creates the admission (reversible via discharge but non-trivial). ConfirmDialog guards submit, not open. Matches Sprint 3 convention.

### 6c. OPD modal stacking

OPD assessment is already a modal inside `<app-today-consultations>`. The admit modal stacks on top of it. ConfirmDialog scrim stacks further. `z-index` rely on DOM stacking order — verified against existing scrim CSS pattern (MLC close-dialog uses the same stack and works).

### 6d. OPD submit must persist `formData.id`

Current `submitForm()` doesn't set `formData.id = res.id` after create. Without this, `isEditMode && formData.id` stays false indefinitely and the Admit button never enables. Minor idiomatic patch — set `this.formData.id` and flip `this.isEditMode = true` on create success. Does not change the save-then-close flow; just captures the created id locally.

## 7. Build order

1. `AdmitToIpdModalComponent` (shared/ui) + CSS + 4–5 tests.
2. `OpdService.admitToIpd()` method + 2–3 service tests.
3. OPD component patch (button + disabled + tooltip + submitForm id-capture) + 2–3 component tests.
4. Emergency list patch (un-stub + modal wiring) + 2 component tests.
5. Wire P7 into AppModule; verify routes unchanged.
6. Backend integration tests for `convertOpdToIpd` + `convertEmergencyToIpd` + controller wrappers (4–6 tests).
7. Run tests (isolated subset + full suites, frontend + backend).
8. Sync + parity docs.
9. Update ui-patterns.md (P7 section), sprint-3-backlog.md (flagged items).
10. Report.

## 8. Test plan

### Frontend (~10–12 tests)

**AdmitToIpdModalComponent (4–5 tests):**
1. Renders with OPD source — admissionType defaults to `'elective'`.
2. Renders with Emergency source — admissionType defaults to `'emergency'`.
3. Submit invalid form (no ward/bed) → ConfirmDialog does NOT open.
4. Submit valid form → ConfirmDialog opens, confirm dispatches to `OpdService.admitToIpd` for source=opd; `admitted` event fires with `{admissionId, admissionNo}`; modal closes.
5. Submit valid form for source=emergency → dispatches to `EmergencyService.convertToIPD`; error case keeps form populated.

**OpdService.admitToIpd (2–3 tests):**
6. Happy — POSTs to `/api/opd/admit-to-ipd` with expected body.
7. 400 error surfaces as `HttpErrorResponse`.
8. 500 error surfaces.

**OPD component patch (2 tests):**
9. Admit button disabled when `isEditMode=false` (tooltip present) → disabled.
10. After successful save, `formData.id` populated + `isEditMode=true` → Admit button enabled; clicking sets `admitModalVisible=true` with correct context.

**Emergency list patch (2 tests):**
11. `convertToIPD(id)` opens the modal with source=`'emergency'` and correct context.
12. `onAdmitted` reloads the list.

### Backend integration (4–6 tests)

**`POST /api/opd/admit-to-ipd` (2 tests):**
1. Happy path — returns 201 with ipdAdmission + pendingPrescriptions + pendingInvestigations; admission row has `sourceModule='opd'`, `referralOpdId=<appointmentId as string>`; bed flipped to `occupied`; HMIS audit log written (module=`'ipd'`, action=`'admission_from_opd'`, status=`'success'`).
2. HMIS failure — returns 201, bed still occupied, failure audit row captures status + detail, no `hmisAdmissionId` persisted.

**`POST /api/emergency/:id/convert-to-ipd` (3 tests):**
3. Happy path — returns 201 with ipdAdmission + mlcCase + pendingPrescriptions + pendingInvestigations; admission has `sourceModule='emergency'`, `referralEmergencyId=<id as string>`; emergency status flipped to `'admitted-ipd'`; HMIS audit success.
4. MLC linkage — when the emergency has an associated `MlcCase`, `referralMlcId` is populated.
5. HMIS failure — admission + bed occupancy + emergency status still update; failure audit row captures.

Target: **14–18 tests total** (11 UI + 3–6 backend, flexing if a helper needs extra coverage).

## 9. Files that will change

**New:**
- `src/app/shared/ui/admit-to-ipd-modal/admit-to-ipd-modal.component.ts`
- `src/app/shared/ui/admit-to-ipd-modal/admit-to-ipd-modal.component.html`
- `src/app/shared/ui/admit-to-ipd-modal/admit-to-ipd-modal.component.css`
- `src/app/shared/ui/admit-to-ipd-modal/admit-to-ipd-modal.component.spec.ts`
- `src/api/opd/__tests__/opd-admit.test.ts` (or extend an existing one)
- `src/api/emergency/__tests__/emergency-convert.test.ts` (or extend existing)
- `docs/modules/admit-to-ipd-sync.md`
- `docs/modules/admit-to-ipd-parity.md`

**Modified:**
- `src/app/services/opd-assessment/opd-assessments.service.ts` — new `admitToIpd()` method.
- `src/app/services/opd-assessment/opd-assessments.service.spec.ts` — new tests.
- `src/app/assessment/opd-assessment/opd-assessment.component.{ts,html,css}` — new button + modal + submit patch.
- `src/app/emergency/emergency-list/emergency-list.component.{ts,html}` — un-stub + modal wiring.
- `src/app/app.module.ts` — declare `AdmitToIpdModalComponent`.
- `docs/ui-patterns.md` — add P7 section.
- `docs/sprint-3-backlog.md` — flagged items (OPD diagnosis placeholder; orphaned `IpdAdmissionComponent`).

## 10. Out of scope (per approval)

- Estimation+OT integration (Sprint 4+ if clinically justified).
- Direct admission flow (`IpdAdmissionComponent` stays orphaned — Sprint 3g/4).
- Schema changes (none needed; referral pointer design preserved).
- HMIS-audit action renaming (helper uses `admission_from_opd` / `admission_from_emergency`, not Sprint 2a's `admission_created` — semantically more specific, preserved).
- Helper signature expansion (diagnosis/roomType/department overrides not accepted — backlog entry).
