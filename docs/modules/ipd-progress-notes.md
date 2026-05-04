# Sprint 3a-2 — IPD Progress Notes (frontend)

Sprint: 3a-2. NABH: **COP.2 — Assessment of Patients (SOAP progress notes)**.
Source rows: `docs/GAP_ANALYSIS.md` Module 6 (IPD Progress Notes).

## Step 1 — Plan

### What this module does

Doctors and nursing staff record a **SOAP-format progress note** for an active IPD admission and review the chronological list of prior notes on the same admission. Notes are NABH COP.2 evidence — one note per clinical review, ordered most-recent-first, with optional vitals snapshot.

### Models / endpoints (backend — already exists, unchanged)

- `IpdProgressNote` Prisma model ([schema.prisma:1491-1513](../../prisma/schema.prisma))
  - `id, admissionId, date, doctorName, subjective, objective, assessment, plan, nursingNotes?, vitalsBP?, vitalsHR?, vitalsTemp?, vitalsSpO2?, vitalsRR?, createdBy?`
  - Relation: cascade-deletes with `IpdAdmission`.
- `POST /api/ipd/admission/:admissionId/progress-note` — create
  - Required body fields: `doctorName, subjective, objective, assessment, plan` (per backend validation).
  - Responses: `201` success / `400` missing required fields / `404` admission not found / `500`.
- `GET /api/ipd/admission/:admissionId/progress-notes` — list
  - Query params: `page`, `limit` (defaults `1`, `10`).
  - Response: `200 { message, data, pagination: { total, page, limit, pages } }`.

**No backend change required.** If the Figma-derived UI surfaces a new field, stop and ask; do not silently extend.

### Patterns composed (from `docs/ui-patterns.md`)

| UI element | Pattern section | Notes |
|---|---|---|
| Page heading + breadcrumb-like context (admission no) | §5c page heading | Uses `--font-size-2xl` navy heading |
| SOAP entry form (textareas + vitals inputs) | §1 FORM | Label above input; 8px label-input gap; 30px section gap |
| Primary submit / secondary cancel buttons | §4 BUTTON | Primary orange for "Save note"; neutral cancel outline |
| List / timeline of prior notes | §2 TABLE-like list, styled as a stacked card list (not a true table row — notes have variable length) | Large text blocks |
| Empty state when no prior notes | §2 gap #9 → `<app-empty-state>` | |
| Unsaved-changes confirmation when navigating away | §3 MODAL → `<app-confirm-dialog severity="danger">` | Uses P1 ConfirmDialog via `UnsavedChangesGuard` |
| Loading spinner while submitting | existing `<app-loader>` | |
| Save-success toast | PrimeNG `MessageService` (see §6) | severity `success` |
| Save-error toast | PrimeNG `MessageService` | severity `error` |

### Reusables imported

- **P1** `ConfirmDialogComponent` (new, this sprint) — for unsaved-changes warning.
- **P4** `EmptyStateComponent` (new, this sprint) — for "no progress notes yet".
- Existing `LoaderComponent` via `LoaderService` + interceptor.
- Existing `MessageService` (PrimeNG) for toasts.

### New reusables built this sprint

None beyond P1 + P4. Progress-note list is a feature-specific stacked-card layout, not generic enough for `shared/`.

### Routes

```
/ipd/admission/:admissionId/progress-note
  → IpdProgressNoteComponent
  canActivate: [authGuard]
  canDeactivate: [UnsavedChangesGuard]   ← uses ConfirmDialog
```

Linked from `IpdOverviewComponent` (future Sprint 3a-3 wiring — out of scope now; for now the route is accessible via URL for manual testing).

### NABH COP.2 field requirements

- `doctorName` — mandatory (clinical accountability, MRD.1).
- `subjective` — mandatory (patient-reported).
- `objective` — mandatory (observed vitals + exam findings).
- `assessment` — mandatory (clinical impression).
- `plan` — mandatory (next steps).
- `nursingNotes` — optional free text (nurse-authored addendum).
- `vitalsBP / HR / Temp / SpO2 / RR` — optional snapshot; capturing any at least one is strongly recommended per COP.2 but not enforced by schema.

All five mandatory fields validated client-side (`Validators.required`) before submit; backend re-validates with the same list.

### Gaps invoked beyond the 5 already answered

None for this module. Form focus/error/disabled/caption/empty-table already decided. Unanswered gaps #3, #4, #10-16, #18-26 don't apply to this screen.

### Testing plan

- **Service** (`IpdService.addProgressNote` + `getProgressNotes`): 4 tests
  1. Happy path POST — correct URL, method, body
  2. Happy path GET — correct URL, method, returns array from `.data`
  3. GET handles 404 (admission not found)
  4. POST handles 500 (server error)
- **Component** (`IpdProgressNoteComponent`): 5 tests
  1. Initial render: form + empty-state shown when no prior notes
  2. Form invalid → submit button disabled; five required-field validators wired
  3. Valid submit → service called with note payload + admissionId; form resets after success
  4. Prior notes load → empty-state replaced by stacked-card list
  5. Navigate-away when form dirty → `canDeactivate()` returns the observable from ConfirmDialog

Total new tests: **4 + 5 = 9** (matches brief target 8-10).

### Seed-data decision

**Needed for manual browser testing.** Dev DB has no IpdAdmission rows, so `GET /ipd/admission/:id/progress-notes` returns 404. I'll write a minimal seed script `scripts/seed-ipd-progress-notes.ts` only if the user wants manual testing; automated tests use mocked HTTP exclusively.

### Hard-rule checks

- [ ] Zero hardcoded hex in component CSS
- [ ] Zero `any` / `@ts-ignore` in component or service additions
- [ ] Tokens consumed via `var(--...)` CSS custom properties
- [ ] Reactive forms with `Validators.required` on 5 SOAP fields
- [ ] `HttpTestingController.verify()` via `installHttpVerify` in every spec
- [ ] ConfirmDialog imported, not re-implemented
- [ ] EmptyState imported, not re-implemented
- [ ] Full frontend test suite pass count reported before/after
