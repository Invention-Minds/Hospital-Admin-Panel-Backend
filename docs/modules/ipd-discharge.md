# Sprint 2b — IPD Discharge (Backend HMIS push wiring)

Source rows: `docs/GAP_ANALYSIS.md` Module 7 and Module 9.
Scope: wire a real HMIS push through the Sprint-1 wrapper for `POST /api/ipd/admission/:admissionId/discharge`. Close the silent-stub gap. Persist `hmisDischargeId` from HMIS on success. No frontend. No Figma.

---

## Step 1 — Plan

### What the gap analysis says
- `IpdDischarge` schema: present; `medications` is `String @db.LongText` not a JSON column (keeping). `hmisDischargeId String?` field already exists. `doctorSignature` for NABH MRD.3 is missing — noted as Sprint 4 item, not 2b.
- `POST /api/ipd/admission/:admissionId/discharge` (`createDischarge` handler in [src/api/ipd/ipd.controller.ts](../../src/api/ipd/ipd.controller.ts)): route + handler exist, discharge record created, admission status flipped, bed freed — but **no real HMIS push**. The silent-stub `createHmisAuditLog({ status: 'success' })` at lines 502–512 writes success without any HMIS call.

### What I will CREATE
- Jest integration tests in `src/api/ipd/__tests__/ipd-discharge.test.ts` covering happy, HMIS-failure, missing-field, and already-discharged paths.
- A `buildIpdDischargeHmisPayload` helper exposed from `ipd.controller.ts` so tests can assert the HMIS payload shape without re-deriving it.

### What I will PATCH
- Remove lines 502–512 (silent stub audit log) in `createDischarge`.
- Replace with a single `syncWithHmis(...)` call wrapping `pushIPDDischarge` (inline-await per the Sprint 2 HMIS latency policy).
- After a successful push whose result has `id`, persist it to `discharge.hmisDischargeId` via `prisma.ipdDischarge.update` and return the updated discharge in the 201 body.
- Add an already-discharged guard before mutation: if `admission.status === 'discharged'` OR an `IpdDischarge` row already exists for this admission, return 409. Prevents double-discharge and the resulting unique-constraint error.

### What I will REFACTOR
- Nothing outside the `createDischarge` handler. `updateIpdAdmission` (line 293 silent audit) stays — it's a separate concern and not part of 2b.
- `hmis-sync.controller.ts` has 6 `(prisma as any)` casts — the user's Sprint 2b note says "clean up if in scope of files you touch". 2b only touches `ipd.controller.ts`, so the webhook controller file isn't in scope. Will revisit in 2c (transfer) or 2d (pharmacy webhooks).

### What I will LEAVE ALONE
- The existing `createFollowUpAppointment` auto-creation block (lines 514–528). It's pre-existing, wrapped in try/catch, and the user flagged follow-up as a Sprint 4 item with "do not build it yet" — interpreted as *do not add or modify follow-up logic*. Since it doesn't break discharge and is not my focus, it stays.
- `medications` stored as JSON string. Previously accepted deviation.
- `discharge-pdf-generator.ts` / `downloadDischargePDF` — separate endpoint, not touched.

### HMIS push contract
- `direction`: `push`
- `module`: `discharge` (per wrapper's `HmisModule` enum — dedicated discharge module captures the NABH ACC.5 distinction vs. general `ipd`)
- `entityType`: `discharge`
- `action`: `discharge_created`
- `payload`: the full `discharge` row (includes `admissionId`, `dischargeType`, `finalDiagnosis`, `medications`, `advice`, `followUpDate`, `followUpDoctor`, `dischargeSummary`)
- `operation`: `() => pushIPDDischarge({ admissionId, prn, dischargeDate, finalDiagnosis, dischargeSummary })` — matching `hmis-client.pushIPDDischarge` signature
- `swallowErrors`: not set → defaults to `true`. HMIS failure must NOT break the discharge — the bed is already freed and the admission status is already `discharged` at push time; we cannot roll back without leaving the patient record in a broken state.
- Retry: wrapper default (`maxRetries: 0`). `hmis-client.retryRequest` still does 3× exponential internally.

### Order of operations (important for consistency)
Same order as the current handler to preserve existing side-effect sequencing:
1. Validate required fields → 400 if missing
2. Verify admission exists → 404 if missing
3. **(NEW)** Guard: if `admission.status === 'discharged'` OR existing `IpdDischarge` for this admissionId → 409
4. Create `IpdDischarge` row
5. Update `IpdAdmission.status → 'discharged'`
6. Update `IpdBed.status → 'available'`
7. **(PATCH)** `syncWithHmis` push via wrapper → audit log written on both outcomes
8. If HMIS returned `id`, update `IpdDischarge.hmisDischargeId` and use the updated row in the response
9. Leave existing follow-up block as-is
10. Respond 201 with final discharge

### Response semantics
- On HMIS success with an `id` → 201 body's `data.hmisDischargeId` is populated.
- On HMIS success without `id` → 201 body's `data.hmisDischargeId` is `null`; audit log is still `success`.
- On HMIS failure → 201 body's `data.hmisDischargeId` is `null`; audit log is `failed` with status + error detail; the hourly retry cron re-attempts via `getFailedSyncs`.

### Test plan (4 tests, exceeds minimum of 2)
1. **Happy path**: stub `pushIPDDischarge` → `{ id: 'HMIS-DIS-4' }`. Assert:
   - Response 201, body includes the discharge
   - `prisma.ipdDischarge.create` called once
   - `prisma.ipdAdmission.update` called with `status: 'discharged'`
   - `prisma.ipdBed.update` called with `status: 'available'`
   - `prisma.ipdDischarge.update` called with `hmisDischargeId: 'HMIS-DIS-4'`
   - Audit helper called once with `status: 'success'`, captured result contains `{ id: 'HMIS-DIS-4' }`
2. **Failure path**: stub `pushIPDDischarge` rejects with `response.status: 500`. Assert:
   - Response still 201
   - Bed still set to `available`, admission still `discharged`
   - `prisma.ipdDischarge.update` NOT called (no hmisDischargeId)
   - Audit with `status: 'failed'`, error detail captured
3. **Sanity — 400**: missing `dischargeType` → 400, no HMIS, no DB writes
4. **Sanity — 409 already-discharged**: admission.status already `'discharged'` → 409, no HMIS, no DB writes

### Hard-rule checks
- [ ] No new `any` / `@ts-ignore`
- [ ] Wrapper is used (no raw `pushIPDDischarge` call outside wrapper)
- [ ] Audit log written on success AND failure (via wrapper)
- [ ] No schema change, no migration
- [ ] No frontend change
- [ ] Tests: 2 required (happy + failure); I have 4 (+2 sanity)
- [ ] Bed status → 'available' on discharge (plan step 8) ✓
- [ ] Inline-await per Sprint 2 HMIS latency policy ✓
- [ ] Persist `hmisDischargeId` from HMIS response ✓
- [ ] Follow-up logic NOT built this sprint ✓ (leaving existing untouched)

---

# Sprint 3b — IPD Discharge (frontend)

NABH: **ACC.5 — Discharge Process** (structured summary within 24h, bed release, follow-up advice). Backend fully wired in Sprint 2b (above). This sprint builds the Angular screen that drives it.

## Step 1 — Plan

### What this module does

Records a structured **discharge summary** for an active IPD admission, then atomically (server-side):
- persists the `IpdDischarge` row
- flips the admission status to `discharged`
- flips the bed status back to `available`
- pushes to HMIS via `pushIPDDischarge` + audit log
- returns the persisted row including `hmisDischargeId` so the frontend can confirm the HMIS side succeeded.

Discharge is **irreversible** at the UI level (backend guards against double-discharge with 409). A **ConfirmDialog (severity=danger)** stands between the user and the POST.

### Endpoint contract (already shipped)

`POST /api/ipd/admission/:admissionId/discharge`
- **Required body**: `dischargeType, finalDiagnosis, conditionAtDischarge, dischargeSummary`
- **Optional body**: `proceduresDone, followUpDate, followUpDoctor, medications (array), advice`
- **Server auto-fills**: `dischargeDate, dischargeTime, medications (JSON string), createdBy`
- **Response codes**: 201 | 400 missing-fields | 404 admission-not-found | 409 double-discharge | 500

### Backend `dischargeType` values vs Sprint 3b brief

The Sprint 3b brief lists five discharge types (`normal / LAMA / DAMA / transferred / expired`). Backend accepts **four** (`regular | LAMA | transfer | expired`). Divergences:

| Brief label | Backend value | Handling |
|---|---|---|
| `normal` | `regular` | Aliasing. Form label = "Regular (normal)"; value sent = `regular`. |
| `transferred` | `transfer` | Aliasing. Form label = "Transferred"; value sent = `transfer`. |
| `DAMA` | — (not in backend enum) | **Excluded.** DAMA has its own schema/flow (`DamaRecord`) and its own UI (Sprint 3e). Adding DAMA here would 400 against the backend. |

**Flagged deviation** — see report §gaps. User acknowledgment requested before Sprint 3e.

### Patterns composed (from `docs/ui-patterns.md`)

| UI element | Pattern | Notes |
|---|---|---|
| Page heading + admission context | §5c page heading | `--font-size-2xl` navy heading + muted subheading |
| Form with sections | §1 FORM | Labels above, 8px label-input gap, 30px section gap |
| Discharge-type select | §1 FORM (dropdown subvariant — first use) | PrimeNG `p-dropdown` with token overrides |
| Follow-up date picker | §1 FORM (calendar subvariant — first use) | PrimeNG `p-calendar` wrapped by a form-field |
| Dynamic medications list | §1 FORM (FormArray — feature-specific, not reusable yet) | Each row: name + dose + frequency + duration; add/remove buttons |
| Irreversible-action CTA | §4 BUTTON + §3 MODAL-3a | Primary orange "Discharge patient" opens P1 ConfirmDialog(severity=danger) before POST |
| Unsaved-changes guard | §3 MODAL + existing `UnsavedChangesGuard` | Same pattern as Sprint 3a-2 |
| Success toast | §6 | PrimeNG `MessageService` severity=success |
| Error toast (preserve form) | §6 | severity=error, form values **not** reset |

### Reusables imported

- **P1** `ConfirmDialogComponent` — twice: (a) discharge confirmation, (b) unsaved-changes guard.
- Existing `IpdService.createDischarge()` + `getDischarge()` (unchanged).
- Existing `MessageService`.
- Existing `UnsavedChangesGuard`.

### New reusables built

None. Medications FormArray is feature-specific.

### Route

```
/ipd/admission/:admissionId/discharge
  → IpdDischargeComponent
  canActivate: [authGuard]
  canDeactivate: [UnsavedChangesGuard]
```

On successful discharge the component navigates back to `/ipd`.

### Gaps invoked (beyond the 5 already decided)

- **DAMA value missing from backend enum** — excluded from form. User acknowledgment requested.
- **Select / dropdown option-row hover + selected state** — first use in Sprint 3 work. Narrow extrapolation: hover = `--color-surface-table-head`; selected = `--color-brand-primary` bg + `--color-text-on-dark` text. Flagged for designer.
- **Date picker popup calendar visual style** — first use. PrimeNG defaults retained for the popup; the anchoring input is tokenised. Flagged for designer.

### Testing plan

- **Service** (`createDischarge` + `getDischarge`): 4 tests
  1. `createDischarge` happy — URL/method/body
  2. `createDischarge` 409 — already discharged surfaces as `HttpErrorResponse`
  3. `getDischarge` 404 — no discharge for this admission
  4. `createDischarge` 500 — server error
- **Component** (`IpdDischargeComponent`): 6 tests
  1. Renders form with 4 discharge-type options + all required markers
  2. Form invalid → submit disabled; form valid → enabled
  3. Submit-click opens ConfirmDialog; no POST until user confirms
  4. Confirmed → service called with full payload + medications array; success toast + router navigates
  5. Backend error → error toast with message; form values preserved (no reset)
  6. Unsaved-changes canDeactivate: pristine → true; dirty + cancel → false

Total: **4 + 6 = 10** new tests.

### Seed-data navigation

The Sprint 3 seed script (`scripts/seed-sprint-3.ts`) creates `IpdAdmission` with `admissionNo = SEED-IPD-001`. The seed script prints the uuid at the end. Navigate to:

```
/ipd/admission/<printed-uuid>/discharge
```

Empty form loads; discharge-type dropdown populates; medications row can be added. The seeded admission's bed (`SEED-G-01`) goes back to `available` on successful POST.

### Hard-rule checks (Sprint 3b frontend)

- [ ] Zero hardcoded hex in component CSS
- [ ] Zero `any` / `@ts-ignore`
- [ ] Tokens consumed via `var(--...)`
- [ ] Reactive forms with `Validators.required` on 4 mandatory fields
- [ ] `installHttpVerify()` in service spec
- [ ] ConfirmDialog imported for irreversible action (not just unsaved-changes)
- [ ] DAMA deliberately excluded, flagged
- [ ] Full frontend test count reported before/after
