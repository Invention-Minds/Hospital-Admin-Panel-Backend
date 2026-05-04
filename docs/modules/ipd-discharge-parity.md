# Visual Consistency Check — IPD Discharge (Sprint 3b)

Pattern-transfer check. No dedicated Figma frame exists for the IPD Discharge screen. Comparison is against:

1. [docs/ui-patterns.md §1 FORM](../ui-patterns.md#section-1--form-pattern)
2. [docs/ui-patterns.md §3 MODAL](../ui-patterns.md#section-3--modal--popup-pattern) — used twice via `ConfirmDialog`
3. [docs/ui-patterns.md §4 BUTTON](../ui-patterns.md#section-4--button-pattern)
4. The Progress Notes form ([docs/modules/ipd-progress-notes.md](ipd-progress-notes.md)) — sibling sprint; should look like the same app
5. The existing OPD Prescription form — legacy reference (hardcoded colours; not the source of truth, but the "does it feel consistent" check)

## Field-by-field pattern fidelity

| Element | Pattern spec | Built in IpdDischarge | Match? |
|---|---|---|---|
| Page shell + heading | §5c | same tokens (`--font-size-2xl` navy heading, muted subheading w/ admission id, `--color-surface-page`) | ✅ |
| Form card | §1 | `--color-surface-card` + `--radius-4xl` + `--shadow-elevation-1` + `--space-20` padding, `--space-30` section gap | ✅ identical to Progress Notes |
| Section heading | §1 | `--font-weight-medium` 20px | ✅ |
| Label above input, 8px gap | §1 | `.form__field { gap: var(--space-8); }` | ✅ |
| Input — default | §1 | `.form__input` / `.form__textarea` same selectors as Progress Notes | ✅ |
| Input — focus (Gap #1) | 2px navy border | applied via `:focus` | ✅ |
| Input — error (Gap #2) | 1px danger-strong border | `.form__input--error` toggled by `shouldShowError()` | ✅ |
| Inline error caption (Gap #5) | `--color-danger-strong` + `--font-size-xs` + 4px margin-top | `.form__error` | ✅ |
| Required-field marker | `*` suffix (uncolored) | same as Progress Notes | ✅ |
| Submit disabled (Gap #17) | `--color-surface-alt` + `--color-text-muted` + `cursor: not-allowed` | `.btn:disabled` | ✅ |
| Primary button | `--color-brand-primary` orange + `--color-text-on-dark` + `--radius-md` + 40px height | `.btn--primary` | ✅ |
| Cancel button | neutral outline | `.btn--cancel` identical to Progress Notes | ✅ |
| Footer: cancel left, confirm right | §3 convention | Same order, `justify-content: flex-end`, cancel rendered first | ✅ |
| Confirmation modal for irreversible action | §3 MODAL-3a danger variant | `<app-confirm-dialog severity="danger">` | ✅ |
| Unsaved-changes modal | §3 MODAL-3a danger variant | Same component, different content | ✅ |

## Divergences from pattern (intentional, with reason)

### Dropdown (first use in Sprint 3 work)

No dedicated dropdown pattern section in ui-patterns.md (deferred until this sprint). Narrow extrapolation applied:

| Dropdown sub-element | Chosen | Source |
|---|---|---|
| Collapsed control (the input itself) | `--color-surface-card` bg + `--color-border-input` 1px + `--radius-md` + `var(--space-16)` padding | Mirror of regular text-input treatment |
| Collapsed control — focus | 2px navy (Gap #1) | Consistent with Gap #1 decision |
| Collapsed control — error | 1px danger-strong (Gap #2) | Consistent with Gap #2 |
| Option row — hover | `--color-surface-table-head` (`#edf4fc`) | Alternate surface already observed elsewhere |
| Option row — selected | `--color-brand-primary` bg + `--color-text-on-dark` text | Primary CTA color for positive selection |
| Option row — default | `--color-surface-card` bg + `--color-text-heading` text | Card-interior neutral |

**Flagged for designer.** Minimal, honest, and consistent with tokens — but not ratified.

### Calendar / date picker (first use)

The **anchoring input** is fully tokenised (same as any text input). The **popup calendar overlay** retains PrimeNG defaults. Reason: designing a calendar popup from scratch requires date-cell states (today / selected / disabled / hover / other-month / weekend) that are not in the token set. Any extrapolation would be substantive invention, not narrow.

**Status**: PrimeNG popup is a known visual regression vs. the app's overall aesthetic, but it's functional and accurate. Flagged as a gap for designer attention.

### Dynamic medications list (FormArray)

No pattern precedent in ui-patterns.md (FormArray rows are inherently feature-shaped). Layout chosen:

- Each row: `border: 1px solid --color-border-input` + `--radius-xl` + `--space-16` padding
- Four-column responsive grid (name / dose / frequency / duration) via `repeat(auto-fit, minmax(140px, 1fr))`
- Remove-row button: 40×40 square, `--color-danger-strong` bg, white trash icon, `--radius-md`

Reads as sibling to the bordered note-cards on the Progress Notes screen (same 1px border, same radius step). If MAR (Sprint 3c) needs the same row UX, we'll extract to a `shared/ui/dynamic-field-array/` reusable at that time.

## Cross-check: IPD Discharge vs. IPD Progress Notes

Both screens sit under the same admission workflow and should be indistinguishable in visual rhythm:

| Aspect | Progress Notes | Discharge | Match? |
|---|---|---|---|
| Page root padding | `40px 20px` | same | ✅ |
| Form card shell | tokenised | tokenised | ✅ |
| Section heading weight/size | Medium 20px | Medium 20px | ✅ |
| Label style | 13px Regular heading | 13px Regular heading | ✅ |
| Input height / padding | 16px padding | 16px padding | ✅ |
| Focus state | 2px navy | 2px navy | ✅ |
| Error caption | `--color-danger-strong` 12px 4px margin | same | ✅ |
| Primary CTA | orange 40h | orange 40h | ✅ |
| Cancel button | transparent + input-border outline | same | ✅ |
| Section gap | 30px | 30px | ✅ |

**Verdict**: the two screens render as clearly the same product.

## Cross-check: IPD Discharge vs. existing OPD Prescription form

Observations from [opd-assessment.component](../../../Frontend/Hospital-Admin-Panel/src/app/assessment/opd-assessment/):

| Aspect | OPD Prescription (legacy) | IPD Discharge | Notes |
|---|---|---|---|
| Page bg | `#F0F3FF` (hardcoded) | `var(--color-surface-page)` (same hex) | ✅ identical pixel, cleaner source |
| Heading family | Kanit | Kanit (via token) | ✅ |
| Input style | PrimeNG + custom overrides (mixed) | Full token set | IPD ahead; OPD is Sprint 3g cleanup |
| Button style | Mix of primary-blue + PrimeNG | Full token set | IPD ahead; OPD legacy |
| Hardcoded hexes in component CSS | Multiple | **Zero** | IPD meets hard rule |
| Modal for confirm | sweetalert2 (legacy) | `<app-confirm-dialog>` | IPD is the new standard |

The IPD Discharge screen reads as the forward-looking baseline the existing OPD form will eventually migrate to.

## Intentional omissions (with justification)

1. **DAMA discharge type** — excluded; own flow. Documented in plan.
2. **Discharge PDF download button** — endpoint exists (`GET /api/ipd/admission/:id/discharge-pdf`) but no UI trigger this sprint. Scoped out because discharge creation + PDF viewing are separable journeys; PDF is for later retrieval (e.g., from a "view discharge" screen). Flagged for Sprint 3c/3d planning.
3. **`doctorSignature` signature-pad** — field doesn't exist in backend schema. `ngx-signaturepad` is available; add when schema does (Sprint 4).
4. **Follow-up auto-SMS** — backend has `createFollowUpAppointment` logic; frontend has no direct UI for it (happens server-side on create). No surface needed in v1.

## Sign-off

Ready for user review. Pattern transfer successful — the screen is a sibling of Progress Notes, the hard rules hold, and all divergences are documented and bounded.
