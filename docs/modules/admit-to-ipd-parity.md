# Visual Consistency Check — Admit-to-IPD (Sprint 3f)

Pattern-transfer check. No dedicated Figma frames exist for the Admit-to-IPD modal or the source-screen button additions. Comparison is against:

1. [docs/ui-patterns.md](../ui-patterns.md) §1 FORM, §3 MODAL 3a, §4 BUTTON, §6 EMPTY, P1 ConfirmDialog, P4 EmptyState.
2. Sibling Sprint 3 screens: LAMA/DAMA Register (3e), MLC Detail (3d), IPD Discharge (3b).
3. Existing OPD assessment (`src/app/assessment/opd-assessment/`) + Emergency list (`src/app/emergency/emergency-list/`) — enhanced in place, not rewritten.

## 1. New P7 — AdmitToIpdModalComponent

First new shared reusable in Sprint 3f. Extraction criteria met: two concurrent callers (OPD + Emergency) at launch. Third-caller candidate (direct admission from `IpdAdmissionComponent`) deferred to Sprint 3g/4.

**Shape:** scrim + centered shell + coloured header + form body + right-aligned footer with cancel + primary submit. Same shell geometry as P1 ConfirmDialog (scrim color token, shell radius, shell shadow) — users learning one modal learn both.

**Differences vs. P1:**
- Larger `max-width: 640px` (vs. P1's 480px) — form body needs more horizontal room for the two-column ward/bed grid.
- Body is an HTML form (not just a static message) and is `overflow-y: auto` so long content scrolls without breaking the footer.
- Header stays navy; severity color does not apply at the shell level. Severity is on the nested P1 confirm dialog (warning, per decision).

**Tokens consumed:** `--color-surface-overlay`, `--color-surface-card`, `--color-surface-alt`, `--color-brand-navy-700`, `--color-brand-navy-900`, `--color-brand-primary`, `--color-text-on-dark`, `--color-text-heading`, `--color-text-muted`, `--color-border-input`, `--color-danger-strong`, `--radius-md`, `--radius-xl`, `--shadow-elevation-1`, `--font-family-primary`, `--font-size-sm`, `--font-size-md`, `--font-size-xl`, `--font-weight-light`, `--font-weight-semibold`, `--space-8`, `--space-10`, `--space-16`, `--space-20`, `--size-icon-lg`. Zero hardcoded hex in modal CSS.

## 2. OPD button placement — sibling to Submit + Print

Pre-existing `.buttons` action group in [opd-assessment.component.html](../../../Frontend/Hospital-Admin-Panel/src/app/assessment/opd-assessment/opd-assessment.component.html):

```
[ Submit (green) ][ Print (navy) ][ Admit to IPD (brand-primary orange) ]
```

**New `.admit-button` class:** sibling of `.save-button` + `.print-button`, width 150px, same font-size. Token-only — the existing two buttons hardcode `#169458` (green) and `#0e2970` (navy); those are legacy pre-token hex and are **left untouched per enhance-don't-rewrite**. The new admit button uses `--color-brand-primary` (orange) → distinct color signals the cross-flow action; matches the "primary CTA" convention from Sprint 3 forms.

**Disabled state tooltip** — `pTooltip="Save assessment first"` on hover so the disabled button reads as deliberate, not broken. Per user's explicit UX requirement.

**`admitEligible` rule:** `isEditMode && formData?.id && appointmentId`. Requires the OPD assessment to have been persisted (save returns `id`, `isEditMode` flips true). If the user clicks Submit, then Admit opens immediately (we persist the id on create success — see `submitForm` patch at line ~354).

## 3. Emergency list button — un-stub, no visual change

`EmergencyListComponent` already had a "Convert to IPD" PrimeNG round button (`p-button-rounded p-button-success p-button-sm`, `pi pi-arrow-right` icon, `pTooltip="Convert to IPD"`) in the actions column. It was wired to `this.router.navigate(['/emergency/:id/convert-to-ipd'])` — a route that does not exist.

Sprint 3f un-stubs the click handler: the button now opens the new modal with `source='emergency'` and prefilled `AdmitContext`. Visual is unchanged — `disabled` binding on `row.status === 'admitted-ipd'` stays, so the button visibly grays out once the patient is already admitted.

## 4. Confirm step (P1) — severity=warning

Matches decided severity (admission is significant + reversible via discharge but non-trivial). Copy:

> *"This will create an IPD admission linked to this {OPD visit | Emergency case}. Active prescriptions and investigations will carry forward for review in IPD Pharmacy. Continue?"*

Confirm label: "Admit patient". Cancel label: "Go back". Wider message than other Sprint 3 confirms (mentions carry-forward explicitly) — sets the clinician's mental model for where pending medications land next.

## 5. Context strip (read-only)

Modal body opens with a small card (`.admit-context`) that shows:

- Patient name · PRN
- Referring doctor
- Summary (OPD: treatment plan + investigation text; Emergency: presenting complaint)

Read-only — the modal itself doesn't let the user edit diagnosis/source data. This is by helper design (Sprint 1 helpers accept only ward/bed/doctor/type). The strip prevents the user from losing sight of *who* they're admitting while picking a bed.

Background is `--color-surface-alt`, labels `--font-weight-light` muted, values in heading color — consistent with Sprint 3d MLC Detail summary card and Sprint 3e LAMA/DAMA Detail summary.

## 6. Field/visual consistency — modal body vs. sibling 3 forms

| Aspect | 3a-2 Progress Notes | 3b Discharge | 3c Pharmacy | 3d MLC Register | 3e LAMA/DAMA Register | **3f AdmitToIpd modal** | Match? |
|---|---|---|---|---|---|---|---|
| Form section card | white radius-4xl elevation-1 20pad | same | same | same | same | **n/a — inline modal body, single card is the whole modal** | ✅ (intentional — modal is itself the card) |
| Section title | Kanit Medium 20px | same | same | same | same | **only modal header (Semibold 20px)** | ✅ |
| Label + input shape | §1 FORM | same | same | same | same | same | ✅ |
| Focus state | 2px navy | same | same | same | same | same | ✅ |
| Error state | 1px danger-strong border + danger-strong small text | same | same | same | same | same | ✅ |
| Primary CTA | orange | same | same | same | same | same | ✅ |
| Cancel / secondary | transparent outline | same | same | same | same | same | ✅ |
| Disabled button | `--color-surface-alt` + muted | same | same | same | same | same | ✅ |
| Grid responsiveness | auto-fit minmax(200px, 1fr) | same | same | same | same | **auto-fit minmax(220px, 1fr)** | ✅ (slightly wider for ward-name legibility) |

The modal reads as a full sibling of the Sprint 3 routed forms, just compressed into a dialog shell.

## 7. Empty states (P4)

Two cases where P4 `<app-empty-state>` renders inside the modal:

- **No wards configured** — `getAllWards()` returns `[]`. Copy: "No wards configured" + "Add a ward in Ward Management to proceed."
- **No available beds in selected ward** — filter of `getBedsByWard(wardId)` keyed by `status='available'` returns `[]`. Copy: "No available beds in this ward" + "Choose a different ward or free a bed."

Both render below the corresponding dropdown. Consistent with LAMA/DAMA list empty-state usage.

## 8. Flagged items

### 8a. OPD diagnosis is a generic placeholder

`convertOpdToIpd` writes `diagnosis: "OPD Referral from {doctorName}"` — the modal shows the real OPD treatment plan in the context strip but can't pass it through to `diagnosis` (helper doesn't accept the param). Clinicians fill the real diagnosis via the first IPD Progress Note. **Sprint 4+ candidate** to extend the helper signature.

### 8b. OPD's legacy `.buttons` group has hardcoded hex

`.save-button` (`#169458`) and `.print-button` (`#0e2970`) are pre-token legacy. The new `.admit-button` uses tokens. Mixing is tolerated per enhance-don't-rewrite; full migration of the OPD page is a Sprint 3.5-scoped cleanup.

### 8c. Modal's `[disabled]` on `<select formControlName="bedId">` emits Angular reactive-forms warnings

Angular recommends `control.disable()` over the template `[disabled]` attribute. Warning-level only, doesn't fail tests; flagged for follow-up cleanup in Sprint 3g/4. Trade-off: disabling via control changes `admitForm.valid` calculation until a ward is picked, which would require extra toggling logic — not worth the noise vs. a soft warning.

### 8d. Modal stacks three levels deep

When open from OPD, the modal stacks: TodayConsultations modal (host) → OPD assessment modal (body) → Admit-to-IPD modal (new) → P1 Confirm (optional). All use fixed positioning with `z-index: 1000+` and `position: fixed; inset: 0`. Visually verified against ConfirmDialog which uses the same pattern. **Flagged** as an accessibility concern for Sprint 4+ — deeply nested modals are hard for keyboard + screen-reader users. Not specific to this sprint.

## 9. Verdict

Ready for user review. Hard rules hold:
- Zero hardcoded hex in the **new** CSS (modal + admit button).
- Pre-existing hex in `opd-assessment.component.css` untouched (enhance, not rewrite).
- Reusables imported (P1 × 1, P4 × 2). One new reusable (P7 AdmitToIpdModal) documented in ui-patterns.md.
- Patient context preserved via the source modules (OPD: appointment → PatientDetails via PRN; Emergency: case.prn).
- Inline-await UX — admission returns `{ admissionId, admissionNo }` synchronously from the helper response, surfaced in the success toast.

Four flagged items (§8a–d), all non-blocking, all documented in `sprint-3-backlog.md`.
