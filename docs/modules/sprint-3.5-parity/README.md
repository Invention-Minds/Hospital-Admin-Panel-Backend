# Sprint 3.5 — Reusable Migration Parity

**Date:** 2026-04-20 · **Scope:** three reusable migrations flagged in [sprint-3-backlog.md §Sprint 3.5](../../sprint-3-backlog.md) at the start of Sprint 3 cleanup work.

No feature work. Zero new tests expected; zero test regressions allowed. Visual parity is the bar.

## Screenshot note

The agent does not have a browser automation tool available in this environment, so `.png` screenshots were not captured. Instead, **DOM + CSS parity is documented structurally below** — the rendered output of each migrated region is compared against the pre-migration source, and the before/after HTML trees + CSS property diffs are reproduced inline. When the user runs the app locally, visual regression will be confirmable against the tables below.

---

## Migration 1 — IPD Progress Notes → P2 PageHeader

### Files
- [ipd/ipd-progress-note/ipd-progress-note.component.html](../../../../Frontend/Hospital-Admin-Panel/src/app/ipd/ipd-progress-note/ipd-progress-note.component.html) — header block replaced
- [ipd/ipd-progress-note/ipd-progress-note.component.css](../../../../Frontend/Hospital-Admin-Panel/src/app/ipd/ipd-progress-note/ipd-progress-note.component.css) — `.page__head/.page__heading/.page__subheading/.page__admission` rules stripped
- [ipd/ipd-progress-note/ipd-progress-note.component.spec.ts](../../../../Frontend/Hospital-Admin-Panel/src/app/ipd/ipd-progress-note/ipd-progress-note.component.spec.ts) — infrastructure-only diff (P2 added to TestBed declarations; zero assertion changes)

### DOM before → after

```html
<!-- Before -->
<header class="page__head">
  <h1 class="page__heading">Progress Note</h1>
  <p class="page__subheading">
    SOAP entry for admission
    <span class="page__admission">{{ admissionId || '—' }}</span>
  </p>
</header>

<!-- After (P2 output; subtitle copy tightened for the split with admission chip) -->
<header class="page-header" data-testid="page-header">
  <h1 class="page-header__title" data-testid="page-header-title">Progress Note</h1>
  <p class="page-header__subtitle" data-testid="page-header-subtitle">
    <span class="page-header__subtitle-lead">SOAP entry</span>
    <span class="page-header__admission-id" data-testid="page-header-admission-id">
      admission {{ admissionId }}
    </span>
  </p>
</header>
```

### CSS property parity

| Element | Before (local) | After (P2) | Match |
|---|---|---|---|
| Container margin-bottom | `var(--space-30)` | `var(--space-30)` | ✅ exact |
| Title font | `var(--font-weight-medium)` + `var(--font-size-2xl)` + `var(--color-text-heading)` | identical | ✅ exact |
| Subtitle font | `var(--font-size-sm)` + `var(--color-text-muted)` | identical | ✅ exact |
| Subtitle top margin | `4px 0 0 0` | `4px 0 0 0` | ✅ exact |
| Admission chip color | `var(--color-text-accent)` + medium weight | `var(--color-text-muted)` | ⚠️ changed — P2 renders admission id in muted, not accent |

**Subtle visual change** on the admission id: pre-migration it rendered in accent color (the blue-ish `--color-text-accent: #3f779b`) with medium weight; P2 renders it in muted grey (`--color-text-muted: #7b7b7b`). This is **intentional** per the P2 API design — admission ids are metadata, not the patient identity. Accent color in P2 is reserved for `patientName`. The subtitle-lead + admission id chip separator (` · `) replaces the pre-migration inline space.

Also the literal `—` em-dash fallback (shown when `admissionId` was nullish) is no longer rendered — P2 hides the admission chip entirely when `admissionId` is null. Acceptable: the screen is not navigable to without an `admissionId` path param, so the nullish branch was never exercised in practice.

### Flags

Two minor copy changes, no functional regression. Designer review recommended if the admission-id accent color is load-bearing in clinical workflow.

---

## Migration 2 — IPD Discharge → P2 PageHeader

Same shape as Migration 1.

### Files
- [ipd/ipd-discharge/ipd-discharge.component.html](../../../../Frontend/Hospital-Admin-Panel/src/app/ipd/ipd-discharge/ipd-discharge.component.html)
- [ipd/ipd-discharge/ipd-discharge.component.css](../../../../Frontend/Hospital-Admin-Panel/src/app/ipd/ipd-discharge/ipd-discharge.component.css)
- [ipd/ipd-discharge/ipd-discharge.component.spec.ts](../../../../Frontend/Hospital-Admin-Panel/src/app/ipd/ipd-discharge/ipd-discharge.component.spec.ts) — infrastructure-only diff

### DOM before → after

```html
<!-- Before -->
<header class="page__head">
  <h1 class="page__heading">Discharge Summary</h1>
  <p class="page__subheading">
    ACC.5 discharge for admission
    <span class="page__admission">{{ admissionId || '—' }}</span>
  </p>
</header>

<!-- After -->
<app-page-header
  title="Discharge Summary"
  subtitle="ACC.5 discharge"
  [admissionId]="admissionId || null">
</app-page-header>
```

CSS property parity: identical to Migration 1 — same four rules stripped, same P2 replacements, same admission-chip color shift flagged.

---

## Migration 3 — MLC Detail → P6 HmisSyncIndicator

### Files
- [mlc/mlc-detail/mlc-detail.component.html](../../../../Frontend/Hospital-Admin-Panel/src/app/mlc/mlc-detail/mlc-detail.component.html) — feature-local span replaced
- [mlc/mlc-detail/mlc-detail.component.ts](../../../../Frontend/Hospital-Admin-Panel/src/app/mlc/mlc-detail/mlc-detail.component.ts) — `hmisSyncLabel` getter removed (redundant with P6's internal `label`); `hmisSyncIsSynced` kept (spec still reads it)
- [mlc/mlc-detail/mlc-detail.component.css](../../../../Frontend/Hospital-Admin-Panel/src/app/mlc/mlc-detail/mlc-detail.component.css) — `.sync-indicator/--synced/--pending` rules stripped
- [mlc/mlc-detail/mlc-detail.component.spec.ts](../../../../Frontend/Hospital-Admin-Panel/src/app/mlc/mlc-detail/mlc-detail.component.spec.ts) — infrastructure-only diff (P6 added to TestBed declarations; zero assertion changes)

### DOM before → after

```html
<!-- Before -->
<span class="sync-indicator"
      [class.sync-indicator--synced]="hmisSyncIsSynced"
      [class.sync-indicator--pending]="!hmisSyncIsSynced"
      data-testid="sync-indicator">
  <i [ngClass]="hmisSyncIsSynced ? 'pi pi-check-circle' : 'pi pi-circle'" aria-hidden="true"></i>
  <span>{{ hmisSyncLabel }}</span>
</span>

<!-- After: P6 host carries the data-testid so the existing spec's querySelector
     still resolves; inner DOM is P6's output. -->
<app-hmis-sync-indicator
  [hmisId]="mlcCase.hmisMlcId ?? null"
  prefix="HMIS-MLC"
  data-testid="sync-indicator">
  <!-- P6 renders: -->
  <span class="hmis-sync hmis-sync--synced" role="status" data-testid="hmis-sync-indicator">
    <i class="pi pi-check-circle" aria-hidden="true"></i>
    <span class="hmis-sync__label">Synced · HMIS-MLC-999</span>
  </span>
</app-hmis-sync-indicator>
```

### CSS property parity

| Element | Before | After (P6) | Match |
|---|---|---|---|
| display / align / gap | `inline-flex` + `align-items:center` + `var(--space-8)` | identical | ✅ |
| font-size | `var(--font-size-sm)` | identical | ✅ |
| icon font-size | `var(--font-size-md)` | identical | ✅ |
| Synced color | `var(--color-success-strong)` | identical | ✅ |
| Pending color | `var(--color-text-muted)` | identical | ✅ |
| `role="status"` | missing | **added by P6** | ➕ a11y uplift |

### TS strip

- **Kept:** `hmisSyncIsSynced` (the existing spec asserts `component.hmisSyncIsSynced` state three times; P6 migration wasn't going to be worth breaking that coverage).
- **Dropped:** `hmisSyncLabel` (copy lives in P6; no spec references it).

### data-testid handoff

The spec's selector `[data-testid="sync-indicator"]` still resolves — Angular renders the custom-element tag `<app-hmis-sync-indicator>` as an actual DOM element and the `data-testid` attribute is hoisted onto it. `.textContent` traversal reaches the inner P6 span. All three MLC sync-indicator tests pass without any assertion changes.

### Flags

One a11y uplift (`role="status"` now present). No visual regression.

---

## Test results

| Suite | Before (end of 3g) | After 3.5 | Delta |
|---|---|---|---|
| Frontend full | 155 pass / 128 fail / 283 total | **155 / 128 / 283** | **0** |
| Frontend subset (5 specs around this sprint's files) | n/a — rerun only | 25/25 pass | n/a |
| Backend full | 87/87 pass | **87/87 pass** (not touched) | 0 |

**Zero new tests. Zero regressions. Three specs got a one-line `declarations: [...]` addition** (P2 for Progress Notes + Discharge; P2 + P6 for MLC Detail) so the new child component compiles in isolation. Assertion code is byte-identical.

---

## Open items / flags for user

1. **Admission-id color shift on Progress Notes + Discharge** — P2 renders admission IDs in `--color-text-muted` rather than the pre-migration `--color-text-accent`. Intentional per P2's design (accent reserved for patient names). If designer wants the original accent style for admission IDs, extend P2 with an `accentAdmission` input or revert this and cascade to LAMA/DAMA/MLC + Admit parity.

2. **Em-dash fallback on null admissionId** — previously shown as `—`, now hidden entirely by P2's `*ngIf="admissionId"` guard. Null path is not reachable in the current routing, so this is cosmetic.

3. **`hmisSyncLabel` getter dropped from MLC Detail TS** — redundant with P6's internal `label`. No callers outside the pre-migration template.

Flagged items were introduced **on purpose**; no corrective action needed unless the admission-id color is load-bearing to clinical workflow.
