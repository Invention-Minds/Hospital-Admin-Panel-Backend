# Visual Consistency Check — Critical-Values Widget (Sprint 3g)

Pattern-transfer check. No dedicated Figma frame exists for this widget. Comparison against:

1. [docs/ui-patterns.md](../ui-patterns.md) §3 MODAL 3a (navy header bar), §4 BUTTON (focus + disabled states), §6 TOAST (proximity reasoning).
2. Sibling Sprint 3 screens — LAMA/DAMA Detail, MLC Detail, IPD Discharge — for token usage baseline.
3. The existing pre-3g CSS in this component — enhanced in place where tokenization was straight-forward, rewritten (still inside the same file) where the class structure needed restructuring for the `crit-level-*` refactor.

## 1. Placement: floating bottom-right, authenticated shell only

Mount added to [app.component.html](../../../Frontend/Hospital-Admin-Panel/src/app/app.component.html) inside the sidebar-wrapped authenticated branch, after the `.content` div:

```html
<app-sidebar></app-sidebar>
<div class="content"> <app-dashboard-module></app-dashboard-module> </div>
<!-- Sprint 3g — Critical-values widget, authenticated shell only. -->
<app-critical-values-alert></app-critical-values-alert>
```

Does **not** render on login / maintenance / TV-channel / OT-channel / therapy-channel / helpdesk routes — each of these is a separate `*ngIf` branch of `app.component.html`, so the widget only attaches in the authenticated doctor/nurse view. Stacking order with `<p-toast>` (globally mounted lower in the same file) is adjacent, not competing: widget is bottom-right, toast is top-right by default.

## 2. Panel header matches MODAL 3a

| Aspect | ConfirmDialog (P1) | Admit modal (P7) | **Critical-values panel** |
|---|---|---|---|
| Header shell | coloured strip, 60 px tall | solid navy bar | **solid navy bar** (`--color-brand-navy-700`) |
| Header typography | 20 px semibold white | 20 px semibold white | **16 px semibold white** (smaller because panel itself is smaller) |
| Close button | `pi-times` icon, right-side | `pi-times` icon, right-side | `pi-times` icon + `pi-volume-off/up` mute toggle, right-side |
| Scrim | fixed full-screen overlay | fixed full-screen overlay | **none** (widget is non-modal) |

Gradient `#667eea → #764ba2` replaced with `var(--color-brand-navy-700)`. Header now reads as a Sprint 3 modal-family surface. Panel-title font size intentionally dropped to 16 px because the widget panel is 400 px wide vs the full modal's 480–640 px — bigger text would crowd the icon actions.

## 3. Token application — 13 hex → tokens (before → after)

| Before | After | Element |
|---|---|---|
| `#28a745` | `--color-success-strong` | `.alert-button.connected` bg + border; `.connection-indicator.connected` color + border |
| `#dc3545` | `--color-danger-strong` | `.alert-button.disconnected` bg + border; `.connection-indicator.disconnected` color + border; `.result-value` color |
| `#667eea → #764ba2` gradient | `--color-brand-navy-700` solid | `.panel-header` background |
| `#333` | `--color-text-heading` | `.alert-title strong`, `.detail-row span` |
| `#495057` | `--color-text-muted` | `.detail-row label` (muted convention from Sprint 3 forms) |
| `#6c757d` | `--color-text-muted` | `.alert-time`, `.empty-state` |
| `#f0f9ff` | `--color-success-bg-subtle` (new) | `.connection-status.success` background |
| `#fff5f5` | `--color-danger-bg-subtle` (new) | `.connection-status.error` background |
| `#f8f9fa` | `--color-surface-alt` | `.alert-item:hover`, `.alert-details` bg |
| `#dee2e6` | `--color-border-input` | All three border-bottom rules |
| `white` literal | `--color-surface-card` | `.alert-panel` bg, `.connection-indicator` bg |
| `rgba(0,0,0, 0.1/0.15/0.2)` | `--shadow-elevation-1` / `--shadow-elevation-2` | `.alert-button` shadow + hover shadow, `.alert-panel` shadow, `.connection-indicator` shadow |
| TS `#dc3545/#ffc107/#17a2b8/#6c757d` hex returns | CSS `.crit-level-*` classes → `--color-danger-strong/--color-warning-strong/--color-info-strong/--color-text-muted` | Severity icons, badges, left-border stripes |

### Notable substitutions

- **`#dc3545` → `--color-danger-strong` (`#d20006`)** — slight hue shift. Source was Bootstrap's slightly bluer red; the Docminds danger token is a more orange red. Acceptable trade-off: severity is communicated by position + icon + label, not hue alone.
- **`#667eea → #764ba2` gradient → solid navy** — loses the purple fade. Intentional per plan — matches §3 MODAL 3a pattern used across 3d/3e/3f modal headers. Unification > novelty.
- **`#f0f9ff` / `#fff5f5` → new `*-bg-subtle` tokens** — introduces design-system additions per user approval. `--color-success-bg` (`#79cfa6`) and `--color-danger-bg` (`#ff706f`) are badge-saturation, too strong for a full-width strip; the subtle variants keep the semantic hue without shouting.
- **`#17a2b8` (info blue) → `--color-info-strong` (= `--color-brand-navy-700`, `#0e2970`)** — kept info tones in the navy family per user direction. Low-criticality alerts now lean navy instead of Bootstrap teal.

## 4. Severity class structure

Colour truth moved from TS `getCriticalityColor()` hex returns to CSS `.crit-level-*` classes. Three applications per level (icon `.alert-icon`, badge `.alert-level`, left-border stripe `.alert-item`). Selectors are scoped so the same class cascades correctly across all three:

```css
.crit-level-critical .alert-icon { color: var(--color-danger-strong); }
.crit-level-critical.alert-level { background-color: var(--color-danger-strong); }
.crit-level-critical.alert-item  { border-left-color: var(--color-danger-strong); }
```

Identical structure for `.crit-level-high` (warning), `.crit-level-low` (info), `.crit-level-default` (muted).

Template binding changed from `[style.color]="getCriticalityColor(...)"` + `[style.background-color]="getCriticalityColor(...)"` + `[style.border-left]="...getCriticalityColor()"` to single `[ngClass]="getCriticalityClass(...)"`. Easier to maintain; themeable via token changes alone.

## 5. Accessibility — added

| Element | Before | After |
|---|---|---|
| Widget root | plain `<div>` | `role="region"` + `aria-label="Critical value alerts"` |
| Bell button | plain `pButton` | + `aria-label="Critical value alerts, {{unreadCount}} unread"` + `aria-expanded` + `aria-controls="critical-value-panel"` |
| Panel | plain `<div>` | `id="critical-value-panel"` + `role="dialog"` + `aria-modal="false"` + `aria-label="Critical value alerts"` |
| Alerts list | plain `<div>` | `role="log"` + `aria-live="assertive"` + `aria-relevant="additions"` |
| Each alert item | plain `<div>` | `role="alert"` (per-item interrupt) + `[ngClass]="'crit-level-…'"` |
| Dismiss button | `pTooltip` only | + specific `aria-label="Dismiss alert for {{testName}}"` |
| Mute toggle | didn't exist | `aria-pressed="{{muted}}"` + dynamic `aria-label` ("Mute…" / "Unmute…") |
| Close button | `pi-times` icon | + `aria-label="Close alerts panel"` |
| Overlay | no state | `aria-hidden="true"` (purely interaction; screen readers skip) |

Focus management: bell button captures ESC (via `@HostListener('document:keydown.escape')`) to close the panel and returns focus to the bell via `queueMicrotask`. Focus-visible outlines use `--color-brand-navy-900` (dark navy) over the bell and `--color-text-on-dark` (white) over the panel header's navy strip so both are visible.

## 6. Animation binding cleanup

`[@slideIn]` template binding dropped — the component had no `animations: [...]` array wiring, so the binding was silently ignored. CSS `@keyframes slideIn` also removed (it was dead code). The `@keyframes cv-pulse` used by `.alert-button.disconnected` was **kept** — it's a visual heartbeat for the disconnected state — and is suppressed under `@media (prefers-reduced-motion: reduce)` alongside the hover transform.

## 7. Flagged items

### 7a. SSE auto-reconnect has no backoff
Current service reconnects at a fixed 5 s on every error, forever. Under a persistent outage this hammers the backend. **Deferred to Sprint 4** per Step 0 Q8.

### 7b. Mute state is per-browser, not per-user
`localStorage['critical-values-muted']` is a per-origin key. If the same user logs in from another device, mute state doesn't follow. Acceptable for a pure UX preference; flagged for Sprint 4 if per-user sync is desired (would go through PatientDetails-adjacent user preferences, which don't currently exist).

### 7c. Acknowledgement is local-first, not server-first
`clearAlert(id)` currently only removes from the BehaviorSubject; the service's `acknowledgeAlert(alertId, acknowledgedBy)` HTTP path is wired + tested but not invoked by the dismiss button in this sprint. Ack-on-dismiss would be a one-line wire; skipped to avoid coupling dismiss to network success until we have a UX story for "tried to ack, server failed". Flagged for Sprint 4 in the banner-sync doc §2.

### 7d. PrimeNG button `[badge]` override via `::ng-deep`
`.alert-button.connected` / `.disconnected` background overrides use `:host ::ng-deep` because PrimeNG's `p-button` applies its own class-scoped background. Not ideal (the ::ng-deep path is discouraged long-term in Angular), but the PrimeNG theming API doesn't expose a cleaner entry for per-instance color here. Flagged for Sprint 4 if we ship a custom button themer.

## 8. Verdict

Ready for user review. Hard rules hold:
- Zero hardcoded hex in any Sprint 3g-touched file (CSS + TS both).
- 4 new tokens added in the feedback section, documented in `design-tokens.md` with the "flagged for designer review" tag.
- Pattern conformance: panel header matches MODAL 3a; severity classes drop hex-inline-styles; mute toggle respects OS-level accessibility preference.
- A11y uplift: 8 new ARIA landmarks/attributes + keyboard ESC + focus return + prefers-reduced-motion respect.
