# Sprint 2d — IPD Pharmacy Ops (fire-and-forget HMIS pushes)

Source rows: `docs/GAP_ANALYSIS.md` Module 8.
Scope: wire real HMIS pushes through the Sprint-1 wrapper for IPD pharmacy / MAR endpoints. Fire-and-forget pattern (no `await` before responding) per the Sprint 2 HMIS latency policy for high-frequency MAR events during ward rounds.

No frontend. No Figma. No schema change (see §Schema decision).

---

## Step 1 — Plan

### Endpoints in scope (7 total)

| Actual route | Handler | Type | HMIS push? |
|---|---|---|---|
| `GET /api/ipd-pharmacy/admission/:id/review-carryover` | `reviewCarryoverPrescriptions` | read | No — read-only lookup |
| `POST /api/ipd-pharmacy/admission/:id/continue` | `continuePrescription` | write | **Yes** (fire-and-forget) |
| `PUT /api/ipd-pharmacy/prescription/:id/modify` | `modifyPrescription` | write | **Yes** (fire-and-forget) |
| `PUT /api/ipd-pharmacy/prescription/:id/discontinue` | `discontinuePrescription` | write | **Yes** (fire-and-forget) |
| `POST /api/ipd-pharmacy/prescription/:id/administer` | `administerMedication` | write (MAR/MOM.4) | **Yes** (fire-and-forget) |
| `GET /api/ipd-pharmacy/admission/:id/pending` | `getPendingMedications` | read | No — contract test only |
| `GET /api/ipd-pharmacy/admission/:id/mar` | `getMedicationAdministrationRecord` | read | No — contract test only |

Note: paths under `/api/ipd-pharmacy/*` (per gap-analysis Module 8.b path divergence — previously accepted). Route-path refactor not in 2d scope.

### What the gap analysis says
- Every write endpoint has silent-stub `createHmisAuditLog({ status: 'success' })` with no actual HMIS call. Same pattern we've fixed in 2a/2b/2c.
- Fire-and-forget rationale: MAR events fire frequently during ward rounds (every admin of every med for every patient). Blocking on HMIS latency would cripple nursing workflow.

### What I will CREATE
- **3 push methods** in [hmis-client.ts](../../src/api/hmis-sync/hmis-client.ts):
  - `pushIpdPrescription` → `POST /pharmacy/ipd-prescription` (used for continue + modify — prescription lifecycle mutations)
  - `pushIpdPrescriptionDiscontinue` → `POST /pharmacy/ipd-prescription/discontinue` (semantic distinction; HMIS vendor may drive different dispensing logic)
  - `pushIpdMedicationAdmin` → `POST /pharmacy/medication-administered` (MAR / MOM.4 event)
- **4 exported typed payload builders** in [ipd-prescription.controller.ts](../../src/api/ipd/ipd-prescription.controller.ts): `buildIpdPrescriptionContinuePayload`, `buildIpdPrescriptionModifyPayload`, `buildIpdPrescriptionDiscontinuePayload`, `buildIpdMedicationAdminPayload` — exported for test assertions.
- **Test suite** `src/api/ipd/__tests__/ipd-pharmacy.test.ts`:
  - 4 write endpoints × 3 tests (happy + HMIS-failure-path via fire-and-forget rejection + 1 sanity each) = 12 tests
  - `reviewCarryoverPrescriptions` — 1 contract test (empty list + filter by prn + date range semantics)
  - `getPendingMedications` — 1 contract test (returns only status=active + adminStatus=pending)
  - `getMedicationAdministrationRecord` — 1 contract test (pagination + ordering)
  - 15 total. Single file (≤25 per user's split threshold).

### What I will PATCH
- `continuePrescription`: replace silent-stub audit block with fire-and-forget `syncWithHmis(...)` + `.catch()`. No change to response shape (201 unchanged).
- `modifyPrescription`: same pattern. Response unchanged (200).
- `discontinuePrescription`: same pattern. Response unchanged (200).
- `administerMedication`: same pattern. Response unchanged (200). Include MAR log id in the push payload so HMIS can tie back to the admin event.

### What I will NOT CHANGE
- Read endpoints (`reviewCarryoverPrescriptions`, `getPendingMedications`, `getMedicationAdministrationRecord`) — no mutation, nothing to push, just add contract tests to lock their current behavior.
- `createNewPrescription`, `skipMedication`, `getPrescription`, `getMarReport`, `getPrescriptionHistory`, `downloadMedicationList`, `syncPrescriptionWithHmis`, `getAdmissionPrescriptions` — out of the 7-endpoint 2d scope.
- Routes file — endpoint paths stay at `/api/ipd-pharmacy/*`.
- OPD `Prescription.dispensed` column — out of 2d scope. See §Schema decision.

### Schema decision

**No schema changes in Sprint 2d.** Rationale:

1. **`IpdPrescription.hmisRxId String?`** already exists and is the natural place to stash an HMIS-returned id on success — but **fire-and-forget prevents us from capturing it within the request**. We respond to the client before the HMIS push resolves. Persisting `hmisRxId` after-the-fact would require a background listener or a second write triggered from the wrapper callback, which is scope creep for 2d.
   - For now, the HMIS response id is captured in the `HmisAuditLog.response` field (wrapper behavior). Reconciliation jobs can read audit logs and backfill `hmisRxId` later if operational need emerges.
2. **`IpdMedicationLog.hmisMarId`** doesn't exist. Same reason not to add it now — we can't capture it in fire-and-forget, and MOM.4 compliance is satisfied by the local MAR row + the audit log.
3. **OPD-side `Prescription.dispensed` / `updatedBy`** (the question left open in Sprint 2c): **still deferred.** Sprint 2d is IPD pharmacy; the OPD `pharmacyDispensedWebhook` in `hmis-sync.controller.ts` is a Sprint 2e/2f concern when we pull the whole MLC/LAMA/DAMA webhook chain through. MOM.4 coverage for IPD is the priority and is satisfied by the existing `IpdPrescription` + `IpdMedicationLog` models.

Zero new migrations. No data-mutation risk.

### HMIS push contracts

| Handler | direction | module | entityType | action |
|---|---|---|---|---|
| `continuePrescription` | push | `ipd-pharmacy` | prescription | `ipd_prescription_continued` |
| `modifyPrescription` | push | `ipd-pharmacy` | prescription | `ipd_prescription_modified` |
| `discontinuePrescription` | push | `ipd-pharmacy` | prescription | `ipd_prescription_discontinued` |
| `administerMedication` | push | `ipd-mar` | medication-admin | `medication_administered` |

Wrapper `swallowErrors: true` (default) — HMIS failure never blocks or propagates to the client.
Wrapper `maxRetries: 0` (default) — hmis-client still retries 3× internally.

### Fire-and-forget pattern
```typescript
// 1. Local DB mutation (synchronous awaited)
const updated = await prisma.ipdPrescription.update({ ... });

// 2. Respond immediately (status 200/201)
res.status(201).json({ data: updated });

// 3. Fire-and-forget HMIS push — NO await. .catch() neutralises potential
// unhandled-rejection warning if the wrapper itself crashes (wrapper swallows
// HMIS errors already, so this is defensive against wrapper bugs only).
syncWithHmis({ ... }).catch((err) => {
  console.error('HMIS pharmacy wrapper crashed:', err);
});
```

### Test-isolation strategy (per user's hard requirement)

Verified at Sprint 2d Step 0:
- All test files use `jest.mock('../../../service/prisma-client', ...)` to replace Prisma with in-memory mocks. No real connection.
- No `beforeAll`/`afterAll` hooks run migrations.
- `jest.config.js` loads `src/__tests__/jest-setup.ts` which stomps `DATABASE_URL = 'mysql://test:test@127.0.0.1:1/NO_REAL_DB_FOR_TESTS'` so any future test that forgets to mock fails loudly instead of silently hitting dev.
- **Pharmacy tests follow the same pattern**: mock prisma-client + mock hmis-client + mock hmis-audit. Zero real DB calls.

### Migration commands in this sprint

**None.** No schema change → no migration file → no Prisma CLI command that mutates the DB. The only Prisma touch is `npx prisma generate` if required, which is codegen-only (no DB connection). Verification per user's policy: this sprint does not mutate the real DB in any way.

### Hard-rule checks
- [ ] No new `any` / `@ts-ignore`
- [ ] Wrapper used for every HMIS push (no raw hmis-client call outside wrapper)
- [ ] Audit log on success AND failure (wrapper behavior)
- [ ] No schema change, no migration, no DB mutation commands
- [ ] No frontend change
- [ ] 15 tests total (12 write × 3 + 3 read contracts)
- [ ] Fire-and-forget verified via spy on `syncWithHmis` + microtask flush
- [ ] Response body does NOT include any `hmis*Id` field (impossible to capture under fire-and-forget)

---

# Sprint 3c — IPD Pharmacy / MAR (frontend)

Backend shipped Sprint 2d (above) + expanded for UI contract completeness at the start of 3c (see [ipd-pharmacy-sync.md § Sprint 3c Contract Expansion](ipd-pharmacy-sync.md#sprint-3c-contract-expansion-2026-04-19)). This sprint builds the two Angular screens that drive it.

## Step 1 — Plan

### What this module does

Two screens, two clinical roles, both admission-scoped:

**Screen A — Pharmacy Review** (`/ipd/admission/:admissionId/pharmacy`) — doctor / pharmacist view. Two sections:
1. **Carryover prescriptions** — pending OPD/Emergency prescriptions (last 7 days). Actions per tablet row: **Continue / Modify / Discontinue**.
2. **Active IPD prescriptions** — already continued or created in IPD. Actions per row: **Modify / Discontinue**.

**Screen B — Medication Administration Record (MAR)** (`/ipd/admission/:admissionId/mar`) — nurse view. Two sections:
1. **Pending medications** — `active + pending` IPD prescriptions awaiting administration. Action: **Administer**.
2. **Administered log** — read-only history, most-recent-first.

### Routing decision: separate routes (not tabs)

**Chose separate routes.** Tabs aren't in `ui-patterns.md`; adding a tab pattern is new-invention, out of sprint scope. Separate routes match the Sprint 3a-2 + 3b precedent (one-admission-one-route, page heading carries context).

### Medication-row extraction decision: **Option B (feature-local)**

Four row variants emerge:

| Variant | Where | Columns | Primary action(s) |
|---|---|---|---|
| Carryover row | Pharmacy §1 | drug name (generic/brand) · frequency · route · quantity+instructions · source | Continue · Modify · Discontinue |
| Active IPD row | Pharmacy §2 | drug name · frequency · route · started-date · status pill | Modify · Discontinue |
| MAR pending row | MAR §1 | drug name · scheduled time · route · frequency | Administer |
| MAR administered row | MAR §2 | drug name · administered time · administered by · quantity · route · remarks | — read-only |

Columns and actions diverge enough that a unified reusable would need 5+ conditional flags plus per-variant slots — more surface area than four small feature-local templates. **Keeping feature-local.** Re-evaluate if any pair converges later.

### Patient context lookup

Per the going-forward rule ([docs/audits/patient-vs-patient-details.md](../audits/patient-vs-patient-details.md)): lookup via `admission.prn → PatientDetails`.

Frontend flow (on route init, in parallel via `forkJoin`):
1. `IpdService.getAdmission(admissionId)` → returns admission with `prn`.
2. `AppointmentConfirmService.getDetailsByPRN(prn)` → returns `PatientDetails`.
3. `<app-page-header>` (P2) renders the combined context.

### Page heading (new reusable P2)

`<app-page-header>` at [shared/ui/page-header/](../../../Frontend/Hospital-Admin-Panel/src/app/shared/ui/page-header/). Presentational component. Inputs:
- `title: string` (required)
- `subtitle?: string`
- `patientName?: string`
- `patientPrn?: number | string`
- `admissionId?: string`

Composes pattern §5c. Used by both 3c screens; available for 3d+. Three component tests.

### Patterns composed

| UI element | Pattern | Notes |
|---|---|---|
| Page heading + patient context | §5c — P2 new this sprint | |
| Section cards | §2 TABLE / list shell | tokenised white card + heading |
| Tabular rows | §2 | header strip + 1px-bordered row boxes |
| Action buttons in rows | §4 BUTTON | primary / secondary-outline / icon-destructive |
| Modify modal | `p-dialog` + §1 FORM | feature-local, not a new reusable |
| Administer modal | `p-dialog` + §1 FORM | feature-local |
| Discontinue confirmation | §3 MODAL-3a danger — P1 ConfirmDialog | irreversible-action wrapper |
| Empty states × 4 | §2 empty-state — P4 EmptyState | |
| Toasts | §6 | PrimeNG `MessageService` |
| Status pill (active / paused / discontinued) | §2 status-badge convention | mapping documented in parity doc |

### Reusables imported

- **P1** `ConfirmDialogComponent` — Discontinue.
- **P2** `PageHeaderComponent` — shared patient-context heading.
- **P4** `EmptyStateComponent` — four sections × empty.
- Existing `IpdService` + `IpdPrescriptionService` + `AppointmentConfirmService` + `MessageService`.

### Fire-and-forget UX contract

Per brief: backend returns 200/201 immediately; no "syncing to HMIS" spinner / icon / status in the UI; no `hmisRxId` displayed; backend success = UI success. On backend error, show error toast and **keep the modal open** so the user can retry without re-entering form data.

### Gaps invoked (Design Gaps Policy)

One new minor extrapolation (flagged for designer):
- **Status pill for `active` / `paused` / `discontinued`** (Active IPD section). Mapping: `active` → `--color-success-bg` (mirror "Available" badge); `paused` → `--color-warning-bg`; `discontinued` → `--color-surface-alt` + `--color-text-muted` text. Consistent with existing Doctors-list status badges. Flagged in parity doc.

### Testing plan (~25 new tests)

- **Service tests** — 9 in [services/ipd-prescription.service.spec.ts](../../../Frontend/Hospital-Admin-Panel/src/app/services/ipd-prescription.service.spec.ts)
- **Pharmacy component** — 7 in [ipd/ipd-pharmacy/ipd-pharmacy.component.spec.ts](../../../Frontend/Hospital-Admin-Panel/src/app/ipd/ipd-pharmacy/ipd-pharmacy.component.spec.ts)
- **MAR component** — 6 in [ipd/ipd-mar/ipd-mar.component.spec.ts](../../../Frontend/Hospital-Admin-Panel/src/app/ipd/ipd-mar/ipd-mar.component.spec.ts)
- **P2 PageHeader** — 3 in [shared/ui/page-header/page-header.component.spec.ts](../../../Frontend/Hospital-Admin-Panel/src/app/shared/ui/page-header/page-header.component.spec.ts)

Total new frontend tests: **25**. Matches brief's "~19-25".

### Seed-data navigation

With `scripts/seed-sprint-3.ts` run (seeded admission id `8bae92a4-9ad7-47fd-8fea-d10ffe9b41a1`, 2 seeded IpdPrescriptions, zero MAR logs):
- `/ipd/admission/<uuid>/pharmacy` → Active = 2 rows (Ceftriaxone IV, Paracetamol PO); Carryover = empty.
- `/ipd/admission/<uuid>/mar` → Pending = same 2 rows; Administered = empty.
- Click Administer on Paracetamol → modal → submit → row moves to Administered.

### Hard-rule checks (Sprint 3c frontend)

- [ ] Zero hardcoded hex in new component CSS
- [ ] Zero `any` / `@ts-ignore`
- [ ] Tokens consumed via `var(--...)`
- [ ] P1 ConfirmDialog used for destructive Discontinue
- [ ] P4 EmptyState used on all four empty-state surfaces
- [ ] P2 PageHeader built, tested, and documented in ui-patterns.md
- [ ] Patient context via `prn → PatientDetails` (not Appointment.patientId)
- [ ] Fire-and-forget: no HMIS status indicator anywhere in the UI
- [ ] Modal preserves form values on backend error
- [ ] `installHttpVerify()` in service spec at describe scope
- [ ] Status-pill mapping flagged in parity doc
- [ ] Full frontend test count reported before/after
