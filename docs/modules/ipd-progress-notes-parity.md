# Visual Consistency Check — IPD Progress Notes

Sprint 3a-2 Step 6. Pattern-transfer check, not per-pixel parity — no dedicated Figma frame for IPD progress notes exists.

## Reference materials used

1. **[docs/ui-patterns.md §1 FORM pattern](../ui-patterns.md#section-1--form-pattern)** — authoritative pattern derived from Login `9475:449`.
2. **[docs/ui-patterns.md §4 BUTTON pattern](../ui-patterns.md#section-4--button-pattern)** — primary CTA (orange) + cancel (neutral outline).
3. **[docs/ui-patterns.md §3 MODAL pattern](../ui-patterns.md#section-3--modal--popup-pattern)** — for unsaved-changes ConfirmDialog (severity=`danger`).
4. **Existing OPD Prescription form** — [src/app/assessment/opd-assessment/opd-assessment.component](../../../Frontend/Hospital-Admin-Panel/src/app/assessment/opd-assessment/) — the closest "multi-field clinical form" precedent in the current Angular app. Used as a secondary cross-check (not the primary source of truth since that component predates tokens and uses hardcoded colors).

## Side-by-side: FORM pattern (ui-patterns.md §1) vs. built IPD-Progress-Note form

| Element | Pattern spec | Built | Match? |
|---|---|---|---|
| Card shell | `--color-surface-card` + `--radius-4xl` + `--shadow-elevation-1` + inner padding `--space-20` | Same (see `.form` selector in [component.css](../../../Frontend/Hospital-Admin-Panel/src/app/ipd/ipd-progress-note/ipd-progress-note.component.css)) | ✅ |
| Section heading | `--font-weight-medium` 20px `--color-text-heading` | Same (`.form__section-heading`) | ✅ |
| Label above input, 8px gap | `--font-size-sm` `--font-weight-regular`, `gap: --space-8` | Same (`.form__label` + `.form__field { gap: var(--space-8) }`) | ✅ |
| Input — default state | `--color-surface-card` bg + `1px solid --color-border-input` + `--radius-md` + `--space-16` padding + 13px text | Same (see `.form__input` / `.form__textarea` under `:host ::ng-deep`) | ✅ |
| Input — focus state | **Decision #1**: `2px solid --color-brand-navy-900`, no glow | Same (`:focus` rule) | ✅ |
| Input — error state | **Decision #2**: `1px solid --color-danger-strong` | Same (`.form__input--error` class toggled by `shouldShowError()`) | ✅ |
| Inline error caption | **Decision #5**: below input, `--color-danger-strong`, `--font-size-xs`, 4px top margin | Same (`.form__error` + `data-testid="err-*"` captions in template) | ✅ |
| Section → section gap | `--space-30` | Same (`.form { gap: var(--space-30); }`) | ✅ |
| Required-field marker | (gap #4 unresolved — convention adopted: `*` suffix in `--color-danger-strong`) | Used `*` suffix in label text; not colored. **Intentional deviation** — avoiding a colored asterisk token where gap #4 is unresolved. Marker still present, colour ambiguity deferred. | ⚠️ intentional |
| Footer: cancel left, confirm right | §3 convention | Same (`.form__footer { justify-content: flex-end; }` with cancel rendered first then primary) | ✅ |
| Primary button (Save) | `--color-brand-primary` orange, `--font-weight-semibold`, `--color-text-on-dark` | Same (`.btn.btn--primary`) | ✅ |
| Cancel button (neutral) | **Gap #19 unresolved** — convention from ConfirmDialog: transparent bg + heading text + input-border border | Same (`.btn.btn--cancel`) | ⚠️ gap #19 deferred |
| Disabled button | **Decision #17**: `--color-surface-alt` + `--color-text-muted`, `cursor: not-allowed`, no opacity hack | Same (`.btn:disabled`) | ✅ |

## Side-by-side: TABLE / LIST pattern (ui-patterns.md §2) vs. built "Prior notes" list

The prior-notes list is a **stacked-card list**, not a true `p-table`, because notes are variable-length SOAP blocks. But it still maps to the TABLE/LIST pattern's role.

| Element | Pattern spec | Built | Match? |
|---|---|---|---|
| List card shell | White card, `--radius-4xl`, `--shadow-elevation-1`, `--space-20` padding | Same (`.list-card`) | ✅ |
| Card title | `--font-weight-medium`, `--font-size-xl`, `--color-text-heading` | Same | ✅ |
| Empty state | **Decision #9**: centered icon+text layout, 48px vertical padding, `pi pi-inbox`, muted text | Same (`<app-empty-state>` with `pi pi-inbox` default) | ✅ |
| Loading state | (gap #10 unresolved — convention: simple "Loading…" text in muted color) | Used text-only loader: `.list-card__loading`. **Intentional deviation**: no skeleton. | ⚠️ gap #10 deferred |
| Row divider | (gap #12 unresolved) | Used `1px solid --color-border-input` around each note-card (border, not divider line) | ⚠️ gap #12 deferred |
| Row actions (edit/delete) | §2 pattern shows red icon button | Not rendered in v1. Notes are immutable after save (a delete button would be a significant policy decision requiring backend support — NABH/MRD considerations around clinical records). Flagged for product review. | ⚠️ intentional |
| Pagination | (gap #6 unresolved) | Not rendered in v1. Backend supports `?page&limit` but UI doesn't surface it. | ⚠️ gap #6 deferred |

## Cross-check against existing OPD Prescription form

Goals:
- Does the IPD Progress Notes page **feel like it belongs in the same app** as the OPD Prescription form?
- Does it avoid visual regression from legacy components?

Observations (based on [opd-assessment.component.ts](../../../Frontend/Hospital-Admin-Panel/src/app/assessment/opd-assessment/opd-assessment.component.ts) and its HTML/CSS):

| Aspect | OPD Prescription | IPD Progress Notes | Consistency? |
|---|---|---|---|
| Page bg | `#F0F3FF` (hardcoded) | `var(--color-surface-page)` (same hex, tokenised) | ✅ visually identical; IPD cleaner |
| Card bg | white | white (via token) | ✅ |
| Heading typography | Kanit Medium | Kanit Medium (via token) | ✅ |
| Input style | PrimeNG defaults + custom overrides | Tokenized overrides | ✅ shape matches; IPD enforces focus/error states cleanly |
| Button style | Mix of PrimeNG and custom | Tokenized local buttons | ✅ shape matches; IPD uses full token set |
| Hardcoded hexes in component | Multiple (`#2563eb`, `#dc2626`, etc.) | **Zero** | ⚠️ IPD is ahead of OPD; OPD is Sprint 3g+ cleanup |

**Verdict**: the IPD Progress Notes page reads as the same product as OPD Prescription, and visually harmonises better because it consumes tokens. Legacy OPD hardcoded colours are a separate debt line item, not a regression introduced by this sprint.

## Intentional differences from the patterns (with justification)

1. **Required-field asterisk**: single `*` in the label instead of a colored asterisk. Reason: gap #4 unresolved. A token for "required-marker color" doesn't exist; using `--color-danger-strong` for a marker that isn't actually an error would conflate severity. Deferred to designer.
2. **Loading state**: text-only "Loading…" instead of skeleton or spinner. Reason: gap #10 unresolved. `<app-loader>` exists but is a full-page overlay; using it here would hide the still-visible form. Text is the minimal, least-surprising choice.
3. **No per-row action icons** on prior-note cards. Reason: clinical records are typically immutable for MRD/audit purposes; allowing edit or delete on saved SOAP notes is a product decision, not a UI one. Flagged for product review before any row-level affordances ship.
4. **No pagination controls**. Reason: gap #6 unresolved + most IPD admissions have <10 notes. Revisit when real data shows the cap being hit.

## Sign-off

Ready for user review. Side-by-side screenshot comparison against Figma's "Doctor Prescription Form" frame — **blocked**: that frame is not accessible via the node IDs we have (see Phase 3a-1 audit). Pattern transfer was the fallback plan, executed cleanly.
