# UI Patterns — Docminds Admin Panel

Audit date: 2026-04-19. Created in Phase 3a-1 of Sprint 3.

This document catalogues the visual + behavioural patterns found in the existing Figma file + existing Angular app so that Sprint 3 modules can **compose** from them rather than reinvent. Every later Sprint 3 module (IPD progress notes, IPD discharge, IPD pharmacy/MAR, MLC/LAMA/DAMA frontend, etc.) should import what's catalogued here, and flag gaps rather than silently extending.

The Figma file (`S2gYoiH41ihtLjxcAUoYHq` / "Invention Minds LLP") has **no dedicated frames for the new HMIS modules**. It is a pattern source, not a frame-to-code target. Pattern transfer only.

Token terminology: every CSS value below maps back to a token in [src/styles/\_tokens.scss](../../Frontend/Hospital-Admin-Panel/src/styles/_tokens.scss) (or `_tokens.css` mirror). No hardcoded hexes should appear in new components.

---

## Section 0 — Existing Angular reusable-component audit

Before flagging anything as "needs building", walk of [src/app/](../../Frontend/Hospital-Admin-Panel/src/app). No dedicated `shared/`, `common/`, `ui/`, or `components/` folder exists — **reusables are scattered** and feature folders hold their own co-located components. Seven existing items can act as reusables in Sprint 3:

| Path | Type | Pattern it implements | Fit for reuse? |
|---|---|---|---|
| [app/loader/loader.component.ts](../../Frontend/Hospital-Admin-Panel/src/app/loader/loader.component.ts) | Component | Loading spinner (one `@Input() isLoading: boolean`) | ✅ yes — import wherever a loading state is needed |
| [app/delete-confirmation-dialog/delete-confirmation-dialog.component.ts](../../Frontend/Hospital-Admin-Panel/src/app/delete-confirmation-dialog/delete-confirmation-dialog.component.ts) | Component | Delete confirmation modal (`@Input() showDialog`, `@Input() userId`, `@Output() close`) | ⚠️ specific to "delete user" wording — generalise into a `ConfirmDialog` in Sprint 3 when we need a reusable destructive modal |
| [app/sidebar/sidebar.component.ts](../../Frontend/Hospital-Admin-Panel/src/app/sidebar/sidebar.component.ts) | Component | Left navigation rail (role-gated links, collapse toggle, settings modal trigger) | ✅ already used at root; Sprint 3 modules use routes inside this shell |
| [app/signature/signature/signature.component.ts](../../Frontend/Hospital-Admin-Panel/src/app/signature/signature) | Component | Signature pad (ngx-signaturepad wrapper) | ✅ reuse for MLC examination, LAMA/DAMA witness signatures, IPD discharge |
| [app/services/critical-values-alert/critical-values-alert.component.ts](../../Frontend/Hospital-Admin-Panel/src/app/services/critical-values-alert/critical-values-alert.component.ts) | Component | Critical-value SSE alert banner (uses PrimeNG `MessageService`) | ⚠️ hardcodes `#dc3545 #ffc107 #17a2b8 #6c757d` — Sprint 3 cleanup candidate; behaviour is reusable |
| [app/services/loader.service.ts](../../Frontend/Hospital-Admin-Panel/src/app/services/loader.service.ts) | Service | Global loader state | ✅ reuse |
| [app/services/event.service.ts](../../Frontend/Hospital-Admin-Panel/src/app/services/event.service.ts) | Service | Cross-component event bus | ✅ reuse |

**Library stack available out-of-the-box**:

- **PrimeNG 17.18.11** — full component library. Use: `p-table`, `p-inputText`, `p-dropdown`, `p-dialog`, `p-toast`, `p-button`, `p-calendar`, `p-checkbox`, `p-fileUpload`. PrimeNG theme: `saga-blue`. (Registered in `angular.json`.)
- **Angular Material 18.2.6** — overlapping but also present: `mat-form-field`, `mat-dialog`, `mat-menu`, etc. Theme: `azure-blue`. **Use PrimeNG first** — it's more heavily used in the existing code, and mixing both causes visual inconsistency.
- **PrimeFlex 3.3.1** — utility classes for flex/grid. Available but don't require.
- **sweetalert2** — used sporadically; avoid in new code (PrimeNG dialog/toast is consistent).
- **ngx-signaturepad** — signature capture.
- **pdfmake, jsPDF, html2canvas, exceljs** — export/PDF pipelines (already used by OPD / dashboard).

**Gap**: no shared folder. Sprint 3 should establish `src/app/shared/` for new reusables (`shared/ui/confirm-dialog/`, `shared/ui/page-header/`, etc.).

---

## Section 1 — FORM pattern

**Source frame**: [Login `9475:449`](https://www.figma.com/design/S2gYoiH41ihtLjxcAUoYHq?node-id=9475-449) (only rich form frame available; others referenced in the brief — Doctor Prescription Form, Settings — Profile Edit, Settings — Reset Password, MHC forms — are not exposed via the node IDs we have. Gap flagged; see §Gaps below.)

**Visual reference**: screenshot verified — centred card on dark background; each field is a stacked label + input pair with `8px` gap (`--space-8`); fields are stacked with `30px` gap between groups (`--space-30`); primary CTA is full-width bottom.

**Anatomy** (from `get_design_context` on 9475:449):

| Element | Token(s) | Value from Figma |
|---|---|---|
| Form card background (on dark page) | `--color-surface-glass-fill`, `--color-surface-glass-border` | `rgba(88,130,193,0.28)` fill, `rgba(88,130,193,0.49)` 2.134px border, `backdrop-blur-[8.893px]` |
| Card outer padding | `--space-40` (both axes) | `px-[80px] py-[40px]` (login oversized; general form padding = 40px) |
| Field label | `--font-family-primary`, `--font-weight-regular`, `--font-size-sm`, `--color-text-on-dark` (dark bg) or `--color-text-heading` (light bg) | 13px Regular |
| Label → input gap | `--space-8` | `gap-[8px]` |
| Input container | `--color-surface-card`, border `0.711px solid --color-border-input`, `--radius-sm`, padding `--space-16` | `#ffffff` bg, `#bcbec0` border, `5px` radius (⚠️ likely scale artifact — use `--radius-md` = 8px) |
| Input text + placeholder | `--font-size-sm`, `--color-text-placeholder` for empty | 13px, `#bcbec0` |
| Input inner control (e.g. eye-toggle) | right-aligned `justify-between`, size `11.383px` | eye icon; gap via flex |
| Group → group gap | `--space-30` | 30px |
| Primary CTA | Section 4 — button pattern | "Sign in" orange full-width below the form |

**Field states captured**: default (empty), default (filled). **Missing from the frame**: focus, error, disabled. All three are unresolved design gaps — see Design Gaps Policy §.

**Required-field marker**: not visible in the Figma frame. Convention: use `*` suffix in label rendered in `--color-danger-strong`. Confirm with designer before Sprint 3 build.

**Inline validation caption placement**: not present in the frame. Convention: below input, `--font-size-xs` / `--color-danger-strong` for error.

**Textarea / select / radio / file-upload**: no observed example in the captured frames. PrimeNG `p-inputTextarea`, `p-dropdown`, `p-radioButton`, `p-fileUpload` should be used with the same token values. Flagged.

**Date picker**: no observed example. Use PrimeNG `p-calendar` with token values.

**Save / cancel footer**: not shown in the Login frame (single-CTA form). Convention from modal pattern (§3): cancel **left**, primary **right**.

### Implementation recipe for Sprint 3 forms

No existing reusable wrapper exists. Compose from **PrimeNG primitives + Reactive Forms** directly per-feature. Rationale: Angular Material and PrimeNG both ship full form-field wrappers; a custom wrapper would add surface area with no win.

```html
<form [formGroup]="form" (ngSubmit)="submit()" class="form">
  <!-- Section heading (large modules) -->
  <h2 class="form__section-heading">Vital Signs</h2>

  <!-- Label + input pair -->
  <div class="form__field">
    <label for="bp" class="form__label">Blood Pressure</label>
    <input pInputText id="bp" formControlName="bp" placeholder="120/80" />
    <small class="form__error" *ngIf="form.get('bp')?.touched && form.get('bp')?.errors">
      {{ errorMessage('bp') }}
    </small>
  </div>

  <!-- Buttons in modal footer or page footer -->
  <div class="form__footer">
    <p-button label="Cancel" severity="secondary" (onClick)="cancel()"></p-button>
    <p-button label="Save" type="submit" [disabled]="form.invalid"></p-button>
  </div>
</form>
```

```scss
@use 'src/styles/tokens' as *;
.form {
  font-family: var(--font-family-primary);
  color: var(--color-text-heading);
  display: flex; flex-direction: column; gap: var(--space-30);

  &__section-heading { font-weight: var(--font-weight-medium); font-size: var(--font-size-xl); }
  &__field          { display: flex; flex-direction: column; gap: var(--space-8); }
  &__label          { font-size: var(--font-size-sm); font-weight: var(--font-weight-regular); }
  &__error          { font-size: var(--font-size-xs); color: var(--color-danger-strong); }
  &__footer         { display: flex; justify-content: flex-end; gap: var(--space-10); }
}
:host ::ng-deep .p-inputtext {
  background: var(--color-surface-card);
  border: 1px solid var(--color-border-input);
  border-radius: var(--radius-md);
  padding: var(--space-16);
  font-size: var(--font-size-sm);
}
```

### Gaps invoked (Design Gaps Policy)

> 1. **Focus state on inputs** — undefined in tokens, not in any frame. Ask: "primary navy `#001345` 1px border? or `#3f779b` accent?"
> 2. **Error state** — red border. Ask: use `--color-danger-strong` or `--color-danger-bg` for the border?
> 3. **Disabled state** — not shown. Ask: `--color-surface-alt` bg + `--color-text-placeholder` text?
> 4. **Required-field marker** — not shown.
> 5. **Inline error caption** — placement and style not shown.

Sprint 3a-2 (IPD Progress Notes) will invoke gaps 1, 2, 5 for SOAP form fields. Expect stop-and-ask.

---

## Section 2 — TABLE / LIST pattern

**Source frames** (all verified by screenshot):
- [Dashboard `9142:371`](https://www.figma.com/design/S2gYoiH41ihtLjxcAUoYHq?node-id=9142-371) → **Doctors List** + **Appointment Request** tables
- [Doctors Available `9149:1991`](https://www.figma.com/design/S2gYoiH41ihtLjxcAUoYHq?node-id=9149-1991)
- [Doctors Unavailable `9149:2208`](https://www.figma.com/design/S2gYoiH41ihtLjxcAUoYHq?node-id=9149-2208)
- [Doctors Absent `9149:2349`](https://www.figma.com/design/S2gYoiH41ihtLjxcAUoYHq?node-id=9149-2349)

**Anatomy**:

| Element | Token(s) | Value |
|---|---|---|
| Table card shell | `--color-surface-card`, `--radius-4xl`, `--shadow-elevation-1`, inner padding `--space-20` | 18px radius, white bg |
| Card title (above table) | `--font-weight-medium`, `--font-size-xl`, `--color-text-heading` | 20px Medium `#271e4a` |
| "See all" link (top-right) | `--font-weight-medium`, `--font-size-xs`, `--color-text-accent` | 12px `#3f779b` |
| Header row | `--color-surface-table-head`, height 42px, `--font-weight-light`, `--font-size-xs`, `--color-text-heading` @ 90% opacity | `#edf4fc` bg |
| Body row | transparent bg, `--font-size-xs`, `--color-text-body` for data, `--color-text-accent` for link columns (e.g. doctor name) | 12px |
| Row divider | raster line (Figma uses `<img imgLine6>`) | 1px line. In Angular, `border-bottom: 1px solid` — color TBD from designer (see Gaps) |
| Row thumb / avatar (list) | `--size-avatar-row` (28px), `--radius-md`, `--shadow-elevation-2` | 28px square |
| Status badge (pill) | see BADGE subsection below | |
| Slot time pill | `--color-warning-bg`, 90×24px, `--font-size-xs` | yellow slot |
| Row action icons (destructive) | `--color-danger-strong` 24×24 tile, `--radius-md`, `--shadow-elevation-2`, icon `--size-icon-sm` | red delete 10329:621 |

**Status badges** (the "Available / Absend / Unavailable" pills are the biggest semantic signal in tables):

| Status | Fill | Text | Glow |
|---|---|---|---|
| Available / Success | `--color-success-bg` (`#79cfa6`) | `--color-text-on-dark` (white) | `--shadow-glow-success` |
| Absent / Danger | `--color-danger-bg` (`#ff706f`) | `--color-text-on-dark` | `--shadow-glow-danger` |
| Unavailable / Warning | `--color-warning-bg` (`#fce35f`) | `--color-text-body` (black — yellow doesn't contrast with white) | none observed |

Size: `68×20px`, `--font-size-xs`, `--font-weight-light`. Shape: rectangular (no radius observed on these pills — verify with designer; likely should match `--radius-md` 8px for consistency).

**Pagination / sort / filter-bar / search-bar**: **not shown** in any of the captured frames. Dashboard table shows "See all" (implies a paginated view elsewhere); Doctors lists show ~4 rows + "See all". Gaps:

### Gaps invoked
> 6. **Pagination pattern** — not visible in the Figma file. Use PrimeNG `p-paginator`? Style with tokens?
> 7. **Sort indicator style** — not shown.
> 8. **Filter / search bar placement** — dashboard has a top-bar "search" (hospital-name input), but no per-table search observed.
> 9. **Empty-state** (no rows returned) — not shown. Biggest gap for Sprint 3 (every new table needs one).
> 10. **Loading state** — not shown. Convention: skeleton rows or the shared `<app-loader>` overlay.
> 11. **Hover state on rows** — no hover-state frame.
> 12. **Row-divider color** — raster image in Figma, hex unknown.

### Implementation recipe

Use **PrimeNG `p-table`** for all Sprint 3 tables. No custom wrapper.

```html
<div class="table-card">
  <div class="table-card__header">
    <h2 class="table-card__title">Progress Notes</h2>
    <a class="table-card__see-all" (click)="seeAll()">See all</a>
  </div>
  <p-table [value]="rows" [paginator]="true" [rows]="10" [loading]="loading">
    <ng-template pTemplate="header">
      <tr>
        <th>#</th><th>Date</th><th>Doctor</th><th>Assessment</th><th>Actions</th>
      </tr>
    </ng-template>
    <ng-template pTemplate="body" let-row>
      <tr>
        <td>{{ row.id }}</td>
        <td>{{ row.date | date }}</td>
        <td class="table-card__link">{{ row.doctorName }}</td>
        <td>{{ row.assessment | slice: 0:80 }}…</td>
        <td>
          <!-- destructive icon button — see Section 4 -->
          <button class="icon-btn icon-btn--danger" (click)="delete(row.id)">
            <i class="pi pi-trash"></i>
          </button>
        </td>
      </tr>
    </ng-template>
    <ng-template pTemplate="emptymessage">
      <tr><td colspan="5" class="table-card__empty">No progress notes yet.</td></tr>
    </ng-template>
  </p-table>
</div>
```

Style overrides against PrimeNG defaults (apply in component SCSS):

```scss
@use 'src/styles/tokens' as *;
.table-card {
  background: var(--color-surface-card);
  border-radius: var(--radius-4xl);
  box-shadow: var(--shadow-elevation-1);
  padding: var(--space-20);
  &__header   { display: flex; justify-content: space-between; align-items: center; }
  &__title    { font: var(--font-weight-medium) var(--font-size-xl) var(--font-family-primary); color: var(--color-text-heading); }
  &__see-all  { font: var(--font-weight-medium) var(--font-size-xs) var(--font-family-primary); color: var(--color-text-accent); cursor: pointer; }
  &__link     { color: var(--color-text-accent); font-weight: var(--font-weight-medium); }
  &__empty    { text-align: center; padding: var(--space-30); color: var(--color-text-muted); }
}
:host ::ng-deep .p-datatable-thead > tr > th {
  background: var(--color-surface-table-head);
  color: var(--color-text-heading);
  font-weight: var(--font-weight-light);
  font-size: var(--font-size-xs);
  opacity: 0.9;
}
```

---

## Section 3 — MODAL / POPUP pattern

**Source frames**:
- [Profile Drop Down `9149:1813`](https://www.figma.com/design/S2gYoiH41ihtLjxcAUoYHq?node-id=9149-1813) — dropdown menu variant
- [Doctors Unavailable `9149:2208`](https://www.figma.com/design/S2gYoiH41ihtLjxcAUoYHq?node-id=9149-2208) — warning modal variant (yellow header)
- [Doctors Absent `9149:2349`](https://www.figma.com/design/S2gYoiH41ihtLjxcAUoYHq?node-id=9149-2349) — danger modal variant (red header)
- [Setting — Locked IDs `14467:1031`](https://www.figma.com/design/S2gYoiH41ihtLjxcAUoYHq?node-id=14467:1031) — settings modal with sub-nav + body
- [Setting — Profile `9142:866`](https://www.figma.com/design/S2gYoiH41ihtLjxcAUoYHq?node-id=9142:866) — same shell, different body

**Two distinct shapes**:

### 3a. Alert / list modal (tall panel, coloured header bar)

| Element | Token | Value |
|---|---|---|
| Scrim | `--color-surface-overlay` | `rgba(0,0,0,0.3)` full-viewport |
| Modal shell | `--color-surface-card`, `--radius-xl` (12px), centred, 525×819 in frames | |
| Header bar (full-width coloured strip) | `--color-warning-strong` (warn) / `--color-danger-strong` (danger); 60px tall | `#e9c400` or `#d20006` |
| Header title | `--font-weight-semibold`, `--font-size-xl`, `--color-text-on-dark` | 20px SemiBold white |
| Close button (top-right) | 14×14 icon at top-right `top-[23px]` | |
| Body row | `--color-surface-row-alt` (`rgba(255,255,255,0.1)`), `--radius-3xl` (16px), height 60px, `--shadow-elevation-1` | |
| Body text | `--font-family-primary`, `--font-weight-regular`, `--font-size-md` | 16px |

### 3b. Settings modal (two-panel: sub-nav + content)

| Element | Token | Value |
|---|---|---|
| Modal shell | `--color-surface-card`, `--radius-xl` (12px), ~700×600 | |
| Sub-nav rail (left, full height) | `--color-brand-navy-700` (`#0e2970`), 160px wide | |
| Active sub-nav item | White tile, `--radius-md`, padding `20px/11px`, text `--color-text-heading` Medium | |
| Inactive sub-nav item | white Medium text, no background | |
| Content area | padded, uses same form/table patterns as rest of app | |
| Inline destructive action (logout link) | `--color-danger-strong` text + icon | |

### 3c. Dropdown / menu

Profile Drop Down `9149:1813` — 180×250 floating panel.

| Element | Token | Value |
|---|---|---|
| Shell | `--color-surface-card`, `--radius-lg` (10px), `--shadow-elevation-1`, overflow clip | |
| Header slot (avatar + name + role + chevron) | inherits `--size-avatar-header` | |
| Divider | 1px line after header + before footer | |
| Menu item | padding 10px 32px, `--font-size-xs`, `--color-text-body` | |
| Destructive menu item (Log Out) | `--color-danger-strong` text colour | |

**Footer-button ordering**: the two list-modal variants (3a) have **no explicit cancel/confirm footer** — only a close [X] icon top-right. For confirm dialogs (e.g. "Delete this progress note?"), convention from existing [DeleteConfirmationDialogComponent](../../Frontend/Hospital-Admin-Panel/src/app/delete-confirmation-dialog/delete-confirmation-dialog.component.ts): **cancel on left, destructive on right**. Verify per-modal.

### Implementation recipe

**Use PrimeNG `p-dialog`** (existing code standard). Style with tokens:

```html
<p-dialog [(visible)]="show" modal="true" [style]="{width: '525px'}" [showHeader]="false">
  <div class="dialog">
    <div class="dialog__header dialog__header--warning">
      <h2 class="dialog__title">Doctors Unavailable</h2>
      <button class="dialog__close" (click)="show = false"><i class="pi pi-times"></i></button>
    </div>
    <div class="dialog__body">
      <ng-container *ngFor="let row of rows">
        <div class="dialog__row">
          <span>{{ row.id }}</span><span>{{ row.name }}</span><span class="dialog__status">{{ row.status }}</span>
        </div>
      </ng-container>
    </div>
  </div>
</p-dialog>
```

```scss
@use 'src/styles/tokens' as *;
.dialog {
  background: var(--color-surface-card);
  border-radius: var(--radius-xl);
  overflow: clip;
  &__header {
    display: flex; align-items: center; justify-content: space-between;
    height: 60px; padding: 0 var(--space-20);
    color: var(--color-text-on-dark);
    &--warning { background: var(--color-warning-strong); }
    &--danger  { background: var(--color-danger-strong); }
  }
  &__title  { font: var(--font-weight-semibold) var(--font-size-xl) var(--font-family-primary); }
  &__close  { background: none; border: none; color: inherit; cursor: pointer; }
  &__body   { padding: var(--space-20); display: flex; flex-direction: column; gap: var(--space-10); }
  &__row    { background: var(--color-surface-row-alt); border-radius: var(--radius-3xl); box-shadow: var(--shadow-elevation-1); padding: var(--space-20); display: flex; gap: var(--space-20); }
}
```

### Gaps invoked
> 13. **Hover / focus state on close button** — undefined.
> 14. **Modal sizes** — only ~525px and ~700px observed. If Sprint 3 needs a small-confirm or full-screen modal, ask.
> 15. **Cancel/confirm footer layout for affirmative modals** — convention picked from DeleteConfirmationDialog but not observed in a frame.

---

## Section 4 — BUTTON pattern

Buttons observed across multiple frames. Extracted patterns:

| Variant | Source | Bg | Border | Text | Radius | Height | Padding | Shadow |
|---|---|---|---|---|---|---|---|---|
| **Primary** | Login "Sign in" (9475:449) | `--color-brand-primary` (`#fb9c2a`) | none | `--color-text-on-dark`, `--font-weight-semibold`, `--font-size-md` | `--radius-md` (use 8px; Figma has 7.115 scale artifact) | 40px | `py: --space-16`, full width | none |
| **Secondary outline** | Setting — Unlock (14469:1603) | `--color-surface-card` | 1px `--color-success-strong` (`#169458`) | `--color-success-strong`, `--font-weight-medium`, `--font-size-xs` | `--radius-md` (observed 6px — flag; probably 8px) | 30px | `py: --space-8`, `px: --space-20` | none |
| **Icon-only destructive** | 10329:621 delete | `--color-danger-strong` (`#d20006`) | none | icon `--size-icon-sm` white | `--radius-md` | 24×24 square | — | `--shadow-elevation-2` |
| **Inline destructive text** | 9149:1813 "Log Out" (9149:1980), 9142:866 "Log out" (9142:1033) | transparent | none | `--color-danger-strong`, `--font-weight-medium`, `--font-size-xs` (dropdown) / `--font-size-xl` (settings modal) | — | auto | — | — |
| **Icon tile button** (header notification / profile) | Dashboard 9142:1365 | `--color-surface-card` | none | icon | `--radius-lg` | `--size-avatar-header` (42×42) | — | `--shadow-elevation-1` |

**Disabled, hover, pressed states**: ❌ not observed in any frame. Design gap for every variant.

### Gaps invoked
> 16. **Button hover state** — undefined for all variants.
> 17. **Button disabled state** — undefined; expect `--color-surface-alt` bg / `--color-text-placeholder` text.
> 18. **Button pressed / active state** — undefined.
> 19. **Secondary button for non-success contexts** — only green (Unlock) observed. Neutral secondary (cancel, back) has no frame. Probably `--color-brand-purple-900` outline?

### Implementation recipe

PrimeNG `p-button` covers most cases. For the icon-only destructive and the inline text variants, plain `button` elements with tokens are simpler than fighting PrimeNG's internals.

```html
<!-- Primary -->
<p-button label="Save" styleClass="btn-primary" type="submit"></p-button>
<!-- Secondary outline -->
<p-button label="Unlock" styleClass="btn-secondary-success" severity="secondary" [outlined]="true"></p-button>
<!-- Icon-only destructive -->
<button class="icon-btn icon-btn--danger" (click)="del()"><i class="pi pi-trash"></i></button>
<!-- Inline text destructive -->
<a class="text-danger" (click)="logout()">Log Out</a>
```

Style the PrimeNG overrides once in `styles.css` (no per-component override needed):

```css
/* styles.css — append after existing rules */
.p-button.btn-primary { background: var(--color-brand-primary); color: var(--color-text-on-dark); border-radius: var(--radius-md); font: var(--font-weight-semibold) var(--font-size-md) var(--font-family-primary); height: 40px; border: none; }
.p-button.btn-secondary-success { background: var(--color-surface-card); color: var(--color-success-strong); border: 1px solid var(--color-success-strong); border-radius: var(--radius-md); font: var(--font-weight-medium) var(--font-size-xs) var(--font-family-primary); height: 30px; }
.icon-btn { display: inline-flex; align-items: center; justify-content: center; border: none; cursor: pointer; }
.icon-btn--danger { background: var(--color-danger-strong); color: var(--color-text-on-dark); border-radius: var(--radius-md); width: 24px; height: 24px; box-shadow: var(--shadow-elevation-2); }
.text-danger { color: var(--color-danger-strong); font-weight: var(--font-weight-medium); cursor: pointer; text-decoration: none; }
```

---

## Section 5 — HEADER / SIDEBAR / NAVIGATION pattern

**Source**: [Dashboard `9142:371`](https://www.figma.com/design/S2gYoiH41ihtLjxcAUoYHq?node-id=9142-371) (verified by screenshot).

### 5a. Sidebar

| Element | Token | Value |
|---|---|---|
| Rail | `--color-brand-navy-900`, `--size-sidebar-width` (80px), full viewport height | |
| Logo | `--size-avatar-logo` (60×60), 10px from top, 30px y-offset | |
| Nav-items container | 18px from top at y=140, width 44px, gap `--space-35` between items | |
| Active item tile | `--color-surface-card`, `--radius-lg`, `--size-sidebar-item` (44×44), `--shadow-elevation-1` | |
| Nav icon | `--size-icon-lg` (24px), positioned 10px into the 44px tile | white (on dark rail) or heading colour (on white active tile) |
| Settings icon (bottom) | `--size-icon-lg`, fixed to `bottom: 960/1024 from top` (~60px from bottom) | |

**Already implemented** at [app/sidebar/sidebar.component.ts](../../Frontend/Hospital-Admin-Panel/src/app/sidebar/sidebar.component.ts). Sprint 3 should **not rebuild** — route to new modules from inside the existing shell. Add `ipd`, `ipd-pharmacy`, `mlc`, `lama-dama` entries if they're missing.

### 5b. Header (top bar inside the dashboard area)

| Element | Token | Value |
|---|---|---|
| Container | content-area, 52-68px tall | |
| Search / hospital-name input | `--color-surface-card`, `--radius-md`, `--shadow-elevation-1`, padding `20px / 13px`, 390×52 | |
| Notification bell tile | `--color-surface-card`, `--radius-lg`, `--shadow-elevation-1`, 42×42 | |
| Profile chip | Layout: 42×42 avatar (left) + name `--font-size-xl` + role `--font-size-base` + chevron 14×7 | |
| Profile avatar | `--size-avatar-header`, `--radius-lg`, `--shadow-elevation-1` | |

**Already partially implemented** in dashboard/sidebar wiring. The **profile dropdown menu** shown on chevron click is [Section 3c](#3c-dropdown--menu) — existing markup can be extracted into a reusable if needed. Flag for Sprint 3 if any module needs to extend the header.

### 5c. Page heading

Large `--font-size-2xl` heading at `left-[110px] top-[102px]` of the dashboard frame, in `--color-text-heading`. Every page should have this: `<h1 class="page__heading">{{ title }}</h1>`.

### Gaps invoked
> 20. **Breadcrumbs** — not observed.
> 21. **Active-route indicator for nested routes** — observed only for top-level nav.
> 22. **Collapsed sidebar state** — the `SidebarComponent.isExpanded` flag exists, but no Figma frame shows the collapsed state.

---

## Section 6 — TOAST / ALERT / BANNER pattern

**Source**: [Notification frame `10329:621`](https://www.figma.com/design/S2gYoiH41ihtLjxcAUoYHq?node-id=10329-621) (verified by screenshot).

**Caveat**: the Figma "Notification" is not a true transient toast. It's a **slide-in notification panel** that partially overlays the dashboard and dims the dashboard card behind it (opacity-60). No auto-dismiss behaviour is visible.

| Element | Token | Value |
|---|---|---|
| Panel | `--color-surface-card`, `--radius-5xl` (20px), ~502×633, positioned right side | |
| Dashboard dim | `opacity: 0.6` on dashboard cards behind the panel | — no token yet (see §Gaps) |
| Title text | `--font-family-primary`, `--color-brand-navy-900`, `--font-size-xl` | 20px `#001345` |
| Bold subtext | `--font-weight-semibold`, same size | |
| Timestamp | `--font-size-base`, `--color-brand-navy-900` | 14px |
| Divider | 1px raster line, ~10px inset each side | |

For **critical-value / success / info / warning toasts** used elsewhere, the existing [CriticalValuesAlertComponent](../../Frontend/Hospital-Admin-Panel/src/app/services/critical-values-alert/critical-values-alert.component.ts) uses **PrimeNG `MessageService`** with `severity: 'error' | 'warn'`. That component is the single SSE-connected banner; use `MessageService` directly for one-off toasts elsewhere.

**Existing [CriticalValuesAlertComponent](../../Frontend/Hospital-Admin-Panel/src/app/services/critical-values-alert/critical-values-alert.component.ts) gap**: hardcodes `#dc3545 #ffc107 #17a2b8 #6c757d`. These are Bootstrap defaults, not Figma tokens. **Sprint 3 cleanup candidate**: replace with `--color-danger-strong / --color-warning-strong / --color-text-accent / --color-text-muted`.

### Gaps invoked
> 23. **True ephemeral toast design** — auto-dismiss, dismiss-X button, info/success/warning/danger variants — not in frames.
> 24. **Dim / overlay token** — `opacity: 0.6` observed as raw style, no token. Propose `--opacity-dimmed: 0.6`.

### Implementation recipe

Transient toasts: **PrimeNG `p-toast` + `MessageService`** (same as existing code). One `<p-toast>` at the root, fire from any component.

```ts
this.messageService.add({ severity: 'success', summary: 'Saved', detail: 'Progress note saved', life: 3000 });
```

Non-transient notification panel (e.g. "you have 5 new requests"): compose from Section 3a alert modal + PrimeNG `p-overlayPanel` if anchored to a trigger, or `p-dialog` if standalone.

---

## Section 7 — DATA CARD pattern

**Source**: [Dashboard stat cards `9142:399, 403, 407, 472, 481, 1954`](https://www.figma.com/design/S2gYoiH41ihtLjxcAUoYHq?node-id=9142:371).

### 7a. Stat card (number + label + icon)

| Element | Token | Value |
|---|---|---|
| Card | `--color-surface-card`, `--radius-2xl` (14px), 201×68, `--shadow-elevation-1` | |
| Icon | `--size-stat-icon` (36×36), left of text | |
| Top number | `--font-family-primary`, `--font-weight-regular`, `--font-size-md`, `--color-text-muted` | `#7b7b7b` |
| Bottom label | `--font-weight-semibold`, `--font-size-md`, `--color-text-heading` | `#271e4a` |

### 7b. Content card (section header + body)

| Element | Token | Value |
|---|---|---|
| Card | `--color-surface-card`, `--radius-4xl` (18px), `--shadow-elevation-1` | |
| Padding | `--space-20` horiz / `--space-20` top | |
| Title | `--font-weight-medium`, `--font-size-xl`, `--color-text-heading` | |
| Section action link ("See all") | `--font-weight-medium`, `--font-size-xs`, `--color-text-accent` | |

### Gaps invoked
> 25. **Card action menu** (three-dot or overflow button) — not observed. If Sprint 3 needs per-card actions, ask.
> 26. **Card empty state** — not observed. If Sprint 3 needs a "no progress notes yet" stat card, ask.

### Implementation recipe

Plain HTML + tokens. No reusable component needed for something this small.

```html
<div class="stat-card">
  <img class="stat-card__icon" [src]="iconUrl" alt="" />
  <div class="stat-card__text">
    <span class="stat-card__number">{{ value }}</span>
    <span class="stat-card__label">{{ label }}</span>
  </div>
</div>
```

```scss
@use 'src/styles/tokens' as *;
.stat-card {
  background: var(--color-surface-card);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-elevation-1);
  padding: var(--space-16);
  display: flex; align-items: center; gap: var(--space-20);
  &__icon   { width: var(--size-stat-icon); height: var(--size-stat-icon); }
  &__number { font-weight: var(--font-weight-regular); color: var(--color-text-muted); font-size: var(--font-size-md); }
  &__label  { font-weight: var(--font-weight-semibold); color: var(--color-text-heading); font-size: var(--font-size-md); }
}
```

---

## Section 8 — TESTING infrastructure audit

### 8.1 Current test runner

**Karma + Jasmine** (Angular-CLI default). Confirmed in [package.json](../../Frontend/Hospital-Admin-Panel/package.json): `jasmine-core ~5.2.0`, `karma ~6.4.0`, `karma-chrome-launcher`, `karma-jasmine`, `karma-jasmine-html-reporter`. Tests run via `npm test` (`ng test`).

TypeScript strict mode is **on** in both `tsconfig.json` (`strict: true`, `noImplicitOverride: true`, `noPropertyAccessFromIndexSignature: true`, `strictTemplates: true`) and `tsconfig.spec.json`.

### 8.2 Existing test files

`.spec.ts` files are scattered throughout — **every component has a co-located spec**, most auto-generated by the Angular CLI `ng generate` scaffolder and **never maintained**.

Sample audit:

- [app.component.spec.ts](../../Frontend/Hospital-Admin-Panel/src/app/app.component.spec.ts) — tests for `'Hello, hospital_appointment_admin_panel'` literal, which is the CLI default template. Real template is the app shell. **This test will fail.**
- [auth.guard.spec.ts](../../Frontend/Hospital-Admin-Panel/src/app/auth.guard.spec.ts) — trivial `expect(executeGuard).toBeTruthy()`. Passes, but asserts nothing.
- Most other specs: identical pattern — create the component, assert `toBeTruthy()`, nothing else.

**Status**: effectively no running test coverage. The stubs are broken or vacuous. **`ng test` has not been treated as a CI gate** on this project.

### 8.3 HTTP mocking pattern

`HttpTestingController` from `@angular/common/http/testing` is the standard. No alternative in use. Sprint 3 adopts it.

### 8.4 TestBed boilerplate for components

Standard `TestBed.configureTestingModule({...}).compileComponents()` followed by `TestBed.createComponent(...)`. No custom helpers exist.

### 8.5 Isolation strategy

**None equivalent to backend's `DATABASE_URL` stomp.** The environment config at `src/environment/` contains real API URLs; tests don't override them, so an accidentally-unmocked HttpClient call would hit whatever URL is in the active environment file (dev or prod — depending on build config).

**Proposal for Sprint 3** (STOP-AND-ASK before implementing):

> **Keep Karma + Jasmine.** A Jest migration in Sprint 3 would be a 2-4 day side-quest and delay every module. The existing runner works; the tests are the problem, not the runner.
>
> **For NEW Sprint 3 test files**: every `*.spec.ts` MUST
> (a) mock the service layer via `HttpTestingController`
> (b) use `afterEach(() => httpTestingController.verify())` to fail on unmocked calls
> (c) never touch real environment config — import a test-only `environment.test.ts` stub with `apiUrl: 'http://test-only-unreachable/no-real-api'`
>
> **Add a `test-utils.ts`** at `src/app/shared/testing/test-utils.ts` with reusable helpers (common TestBed setup, ReactiveForm builders, mock authService, etc.).
>
> **Do NOT fix / delete the existing broken stubs in Phase 3a-1.** They're outside the Sprint 3 blast radius; addressing them is a separate cleanup sprint. New tests will co-exist.
>
> **Do fix [app.component.spec.ts](../../Frontend/Hospital-Admin-Panel/src/app/app.component.spec.ts)** — it will fail loudly on `npm test` and mask real failures. One-line patch: delete the "Hello, " assertion and keep only `expect(app).toBeTruthy()`.

Waiting for approval before implementing. Details of each proposal are in the Phase 3a-1 report.

---

## Catalogue of design gaps for designer

Twenty-six gaps surfaced in sections 1–7, consolidated:

| # | Pattern | Gap | Blocks |
|---|---|---|---|
| 1 | FORM | Input focus state | All Sprint 3 forms |
| 2 | FORM | Input error state (border + caption) | All Sprint 3 forms |
| 3 | FORM | Input disabled state | All Sprint 3 forms |
| 4 | FORM | Required-field marker style | All Sprint 3 forms |
| 5 | FORM | Inline error caption placement | All Sprint 3 forms |
| 6 | TABLE | Pagination pattern | IPD progress notes list, IPD discharge list |
| 7 | TABLE | Sort indicator style | All Sprint 3 tables |
| 8 | TABLE | Filter / search bar placement | All Sprint 3 tables |
| 9 | TABLE | Empty-state | Every new table |
| 10 | TABLE | Loading state (skeleton? spinner?) | Every new table |
| 11 | TABLE | Hover state on rows | All |
| 12 | TABLE | Row-divider color (raster) | All |
| 13 | MODAL | Close button hover/focus | All modals |
| 14 | MODAL | Other sizes (small-confirm, full-screen) | Confirm dialogs |
| 15 | MODAL | Cancel/confirm footer convention | Confirm dialogs |
| 16 | BUTTON | Hover | All |
| 17 | BUTTON | Disabled | All |
| 18 | BUTTON | Pressed / active | All |
| 19 | BUTTON | Neutral secondary variant (e.g., Cancel) | All |
| 20 | NAV | Breadcrumbs | Nested routes |
| 21 | NAV | Nested active-route indicator | Nested routes |
| 22 | NAV | Collapsed sidebar state design | Responsive work |
| 23 | TOAST | Ephemeral toast variants (info/success/warning/danger, auto-dismiss) | CriticalValuesAlert cleanup + all save/delete UX |
| 24 | TOAST | Dim / overlay opacity as a named token | Notification overlays |
| 25 | CARD | Card action menu | Per-card actions |
| 26 | CARD | Card empty state | Stat cards with no data |

**Highest-priority blockers for Sprint 3a-2 (IPD Progress Notes)**: 1, 2, 5, 9, 17.

---

## Reusable-component build queue (for Sprint 3 — ONE per item, not per module)

These should be built **once**, tested **once**, imported **many**:

| Priority | Name | Where | Pattern | Tests | Status |
|---|---|---|---|---|---|
| P1 | `ConfirmDialogComponent` | [shared/ui/confirm-dialog/](../../Frontend/Hospital-Admin-Panel/src/app/shared/ui/confirm-dialog/) | MODAL 3a | 5/5 pass | ✅ shipped Sprint 3a-2 |
| P2 | `PageHeaderComponent` | [shared/ui/page-header/](../../Frontend/Hospital-Admin-Panel/src/app/shared/ui/page-header/) | NAV 5c | 3/3 pass | ✅ shipped Sprint 3c |
| P3 | StatCard | `shared/ui/stat-card/` | CARD 7a | 3-4 | pending (first dashboard that needs it) |
| P4 | `EmptyStateComponent` | [shared/ui/empty-state/](../../Frontend/Hospital-Admin-Panel/src/app/shared/ui/empty-state/) | TABLE gap #9 | 4/4 pass | ✅ shipped Sprint 3a-2 |
| P5 | `test-utils.ts` | [shared/testing/](../../Frontend/Hospital-Admin-Panel/src/app/shared/testing/) | infra | — | ✅ shipped Sprint 3a-2 |
| P6 | `HmisSyncIndicatorComponent` | [shared/ui/hmis-sync-indicator/](../../Frontend/Hospital-Admin-Panel/src/app/shared/ui/hmis-sync-indicator/) | inline-await sync status | 4/4 pass | ✅ shipped Sprint 3e |

`DeleteConfirmationDialogComponent` (existing) will be **deprecated** by P1 after P1 ships with feature-parity. Don't delete it yet — it's still imported by the Delete-User flow.

### P1 — `ConfirmDialogComponent` API

```ts
import { ConfirmDialogComponent, ConfirmDialogSeverity }
  from 'src/app/shared/ui/confirm-dialog/confirm-dialog.component';
```

```html
<app-confirm-dialog
  [(visible)]="showConfirm"
  title="Discard unsaved changes?"
  message="You have unsaved progress notes. Leave anyway?"
  confirmLabel="Discard"
  cancelLabel="Keep editing"
  severity="danger"
  (confirm)="onConfirm()"
  (cancel)="onCancel()">
</app-confirm-dialog>
```

| Input | Type | Default | Notes |
|---|---|---|---|
| `visible` | `boolean` | `false` | Two-way bindable |
| `title` | `string` | `''` | |
| `message` | `string` | `''` | Single line; multi-paragraph not supported (flag to designer if needed) |
| `confirmLabel` | `string` | `'Confirm'` | |
| `cancelLabel` | `string` | `'Cancel'` | |
| `severity` | `ConfirmDialogSeverity` (`'default' \| 'warning' \| 'danger'`) | `'default'` | Controls header bar color + confirm button color |

| Output | Payload | When |
|---|---|---|
| `visibleChange` | `boolean` | Every state change (for `[(visible)]`) |
| `confirm` | `void` | User clicks the primary confirm button |
| `cancel` | `void` | User clicks the secondary cancel button OR clicks the X close button OR clicks the scrim |

Notes:
- Close button (X) and scrim click both route through `cancel` — callers only need to listen to one "user backed out" event.
- Declared in `app.module.ts`; usable from any component of the module.

### P2 — `PageHeaderComponent` API

```ts
import { PageHeaderComponent }
  from 'src/app/shared/ui/page-header/page-header.component';
```

```html
<!-- Full context (admission screen with patient lookup) -->
<app-page-header
  title="Pharmacy Review"
  subtitle="MOM.1 — active + carryover"
  [patientName]="patient?.name ?? null"
  [patientPrn]="patient?.prn ?? null"
  [admissionId]="admissionId || null">
</app-page-header>

<!-- Minimal (no patient context available yet) -->
<app-page-header title="Progress Note" [admissionId]="admissionId"></app-page-header>
```

| Input | Type | Default | Notes |
|---|---|---|---|
| `title` | `string` | `''` | Required main heading (h1) |
| `subtitle` | `string \| null` | `null` | Optional lead copy (e.g. "ACC.5 — structured summary") |
| `patientName` | `string \| null` | `null` | Rendered in accent color when present |
| `patientPrn` | `number \| string \| null` | `null` | Rendered as "PRN {value}" |
| `admissionId` | `string \| null` | `null` | Rendered as "admission {uuid}" in muted color |

Presentational only — no service injection, no HTTP. Composes tokens from `--font-family-primary` / `--font-size-2xl` / `--color-text-heading` / `--color-text-accent` / `--color-text-muted`. Three component tests cover: renders title, renders full context (name + PRN + admission id), renders minimal (admission id only).

Progress Notes (3a-2) and Discharge (3b) have inline headings that pre-date P2 — they'll migrate to `<app-page-header>` opportunistically when next touched. Pharmacy (3c) and MAR (3c) use it from day one.

### P4 — `EmptyStateComponent` API

```ts
import { EmptyStateComponent }
  from 'src/app/shared/ui/empty-state/empty-state.component';
```

```html
<app-empty-state
  text="No progress notes yet"
  secondaryText="SOAP notes you save will appear here, most recent first.">
</app-empty-state>

<!-- With a different icon (e.g. error-state empty) -->
<app-empty-state
  icon="pi pi-exclamation-triangle"
  text="Could not load results"
  secondaryText="Retry in a moment.">
</app-empty-state>
```

| Input | Type | Default | Notes |
|---|---|---|---|
| `text` | `string` | `''` | Primary headline; required by convention |
| `secondaryText` | `string \| null` | `null` | Optional supporting line |
| `icon` | `string` | `'pi pi-inbox'` | Any PrimeIcon class |

No action slot yet. When the first module needs an "Add first X" CTA, add `<ng-content>` and update this section.

### P6 — `HmisSyncIndicatorComponent` API

```ts
import { HmisSyncIndicatorComponent, HmisSyncIndicatorSize }
  from 'src/app/shared/ui/hmis-sync-indicator/hmis-sync-indicator.component';
```

```html
<!-- Detail view: prominent indicator next to section head -->
<app-hmis-sync-indicator
  [hmisId]="mlc?.hmisMlcId ?? null"
  prefix="HMIS-MLC">
</app-hmis-sync-indicator>

<!-- List row: smaller badge in a narrow column -->
<app-hmis-sync-indicator
  [hmisId]="row.hmisLamaId"
  prefix="HMIS-LAMA"
  size="small">
</app-hmis-sync-indicator>
```

| Input | Type | Default | Notes |
|---|---|---|---|
| `hmisId` | `string \| null` | `null` | `null` renders the pending state |
| `prefix` | `string` | `'HMIS'` | Display prefix (e.g. `'HMIS-MLC'`, `'HMIS-LAMA'`, `'HMIS-DAMA'`). Only prepended if the `hmisId` doesn't already start with it (case-insensitive). |
| `size` | `HmisSyncIndicatorSize` (`'default' \| 'small'`) | `'default'` | `'small'` shrinks typography for list-row badges. Copy is identical between sizes. |

States:

| State | Trigger | Icon | Color | Copy |
|---|---|---|---|---|
| **Synced** | `hmisId` is a non-empty string | `pi pi-check-circle` | `--color-success-strong` | `"Synced · <prefix>-<id>"` (or `"Synced · <id>"` when the id already carries the prefix) |
| **Pending** | `hmisId` is `null` or empty | `pi pi-circle` | `--color-text-muted` | `"Sync pending"` |

Pure presentation. No service injection, no HTTP. First feature-local implementation shipped in Sprint 3d on MLC Detail; extracted in Sprint 3e for reuse across LAMA + DAMA. MLC Detail migrates to this reusable in Sprint 3.5 (tracked in `docs/sprint-3-backlog.md`).

### P7 — `AdmitToIpdModalComponent` API

```ts
import {
  AdmitToIpdModalComponent,
  AdmitContext,
  AdmittedEvent,
} from 'src/app/shared/ui/admit-to-ipd-modal/admit-to-ipd-modal.component';
```

```html
<!-- OPD caller -->
<app-admit-to-ipd-modal
  [(visible)]="admitModalVisible"
  source="opd"
  [context]="admitContext"
  (admitted)="onAdmittedToIpd($event)">
</app-admit-to-ipd-modal>

<!-- Emergency caller -->
<app-admit-to-ipd-modal
  [(visible)]="admitModalVisible"
  source="emergency"
  [context]="admitContext"
  (admitted)="onAdmittedToIpd($event)">
</app-admit-to-ipd-modal>
```

| Input | Type | Default | Notes |
|---|---|---|---|
| `visible` | `boolean` | `false` | Two-way bindable |
| `source` | `'opd' \| 'emergency'` | `'opd'` | Discriminator: picks the backend endpoint + admission-type default |
| `context` | `AdmitContext \| null` | `null` | `{ sourceId, prn?, patientName?, referringDoctor?, summary?, suggestedAdmissionType?, suggestedRoomType? }` — prefills form + renders the context strip |

| Output | Payload | When |
|---|---|---|
| `visibleChange` | `boolean` | Every visibility change (for `[(visible)]`) |
| `admitted` | `AdmittedEvent` = `{ admissionId, admissionNo }` | After successful create; caller typically reloads relevant list |
| `cancelled` | `void` | User dismisses without submitting |

Dispatch contract:
- `source='opd'` → `OpdAssessmentsService.admitToIpd({ appointmentId, wardId, bedId, admittingDoctorId, admittingDoctorName, admissionType })` → `POST /api/opd/admit-to-ipd` → `convertOpdToIpd` helper.
- `source='emergency'` → `EmergencyService.convertToIPD(emergencyId, { wardId, bedId, admittingDoctorId, admittingDoctorName, admissionType })` → `POST /api/emergency/:id/convert-to-ipd` → `convertEmergencyToIpd` helper.

Form shape (FormBuilder): `wardId` (required), `bedId` (required, filtered to available only), `admittingDoctorId` (optional, from DoctorService dropdown), `admittingDoctorName` (required), `admissionType` (default `'elective'` for OPD / `'emergency'` for Emergency).

Submit flow:
1. Invalid form → no confirm, marks touched.
2. Valid form → `<app-confirm-dialog severity="warning">` opens with *"This will create an IPD admission linked to this {OPD visit | Emergency case}. Active prescriptions and investigations will carry forward for review in IPD Pharmacy. Continue?"*.
3. Confirm → dispatch → success toast + emit `admitted` + close modal; OR error toast + modal stays open with form populated.

Patient carry-forward note: the helpers return `pendingPrescriptions` + `pendingInvestigations` in the response (metadata, not inserted rows). The actual per-drug carry-forward happens separately via the IPD Pharmacy review UI (Sprint 3c `reviewCarryoverPrescriptions` → `continuePrescription`). See [admit-to-ipd-sync.md](modules/admit-to-ipd-sync.md) §5.

Five component tests cover: OPD source defaults, Emergency source defaults, invalid-submit does-not-confirm, OPD valid submit → dispatch → emit, Emergency submit error surfaces toast + preserves form.

### P5 — `test-utils.ts` API

```ts
import { installHttpVerify, TEST_API_URL }
  from 'src/app/shared/testing/test-utils';
```

Pattern inside a `describe`:

```ts
describe('FooService', () => {
  let service: FooService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(FooService);
    http = TestBed.inject(HttpTestingController);
  });

  // MUST be at describe scope, NOT inside beforeEach — Jasmine rule.
  installHttpVerify(() => http);

  it(...) { ... }
});
```

`installHttpVerify(getController)` registers an `afterEach` that calls `getController().verify()`. Any pending HTTP request fails the test loudly. Non-negotiable per brief.

`TEST_API_URL` — constant pointing at an unreachable host (`http://test-only-unreachable/no-real-api`). Re-exported for tests that need to construct expected URLs manually.

---

## How Sprint 3 modules use this document

1. Open the module's plan doc (e.g. `docs/modules/ipd-progress-notes.md`).
2. For each UI element needed (form? table? modal?), **quote the relevant pattern section** from this doc.
3. **Import the existing reusable** if Section 0 lists one fit for purpose, **or** build a new reusable per the queue above (with tests).
4. **Don't extend tokens**. If a state isn't tokenised, invoke the Design Gaps Policy and stop.
5. Before reporting module complete: run the Visual Consistency Check (Sprint 3 Step 6) against the source frame(s) listed here.
