# Sprint 3g — Critical-Values Banner Plan

**Date:** 2026-04-20 · **Builds on:** [critical-values-banner-audit.md](./critical-values-banner-audit.md) (Option A approved — floating widget, global mount in authenticated shell).

> **Note on naming:** the doc is called "banner" to stay consistent with the sprint prompt, but the UX shape is a bottom-right **floating bell + togglable panel** widget. Not a top-strip banner. The term "banner" in this sprint is shorthand for the critical-values alert surface.

## 1. Goal

Close the SSE loop. The backend has been broadcasting `critical-value` events since Sprint 2.5 Part B, but no UI consumer is mounted — the component is declared nowhere. This sprint wires the component, tokenizes its styles, adds a11y + mute control, and proves the round-trip with tests.

## 2. Patterns composed

| Pattern | Purpose | From |
|---|---|---|
| Floating widget (fixed bottom-right) | Existing component shape — kept | Current `critical-values-alert.component.css` |
| §3 MODAL 3a | Panel-header navy bar (applies the Sprint 3 modal-header convention to the panel) | ui-patterns.md §3 |
| PrimeNG badge + tooltip | Unread count + hover label on bell | Existing PrimeNG deps |
| `role="log"` container + per-item `role="alert"` | Screen-reader interrupt + history | WCAG 2.1 AG 4.1.3 |

No P-level reusable introduced. This is a one-off widget; no extraction triggers.

## 3. Component architecture

### 3a. CriticalValuesAlertComponent (existing — refactored + mounted)

- **Path:** [src/app/services/critical-values-alert/](../../../Frontend/Hospital-Admin-Panel/src/app/services/critical-values-alert/)
- **Selector:** `app-critical-values-alert`
- **Inputs / outputs:** none — subscribes on init via `AuthServiceService.getUserId()`.
- **State:**
  - `alerts: CriticalValueAlert[]` — history, unshifted on new event.
  - `unreadCount: number` — cleared on panel open.
  - `isConnected: boolean` — reflects SSE state.
  - `showPanel: boolean` — panel toggle.
  - **New:** `muted: boolean` — user-controlled + `prefers-reduced-motion` auto-mute; persisted in localStorage under key `'critical-values-muted'`.
  - **New:** `panelEl` / `bellEl` refs for focus management.

### 3b. Method refactor — `getCriticalityColor()` → `getCriticalityClass()`

Before (returns hex strings bound via `[style.*]`):
```ts
getCriticalityColor(level: string): string {
  switch (level) {
    case 'critical': return '#dc3545';
    case 'high':     return '#ffc107';
    case 'low':      return '#17a2b8';
    default:         return '#6c757d';
  }
}
```

After (returns class names, color lives in CSS):
```ts
getCriticalityClass(level: string): string {
  switch (level) {
    case 'critical': return 'crit-level-critical';
    case 'high':     return 'crit-level-high';
    case 'low':      return 'crit-level-low';
    default:         return 'crit-level-default';
  }
}
```

CSS classes drive color + background via tokens:

```css
.crit-level-critical { color: var(--color-danger-strong); }
.crit-level-critical.alert-level,
.crit-level-critical .badge-fill { background: var(--color-danger-strong); color: var(--color-text-on-dark); }
.crit-level-critical.border-stripe { border-left-color: var(--color-danger-strong); }
/* …and so on for high/low/default */
```

Template bindings change from `[style.color]="getCriticalityColor(...)"` to `[ngClass]="getCriticalityClass(...)"`.

### 3c. Mute toggle + `prefers-reduced-motion`

- `ngOnInit` reads `localStorage.getItem('critical-values-muted')` → `muted = (stored === 'true')`.
- If not stored, check `window.matchMedia('(prefers-reduced-motion: reduce)').matches` → default `muted = true` when motion reduced.
- Panel header gets a small "Mute alerts" toggle icon (`pi-volume-up` / `pi-volume-off`) that flips `muted` and writes to localStorage.
- `playAlertSound()` becomes a no-op when `muted === true`.
- **Not auto-unmuted on reconnect.** User's choice persists.

### 3d. `[@slideIn]` binding dropped

The template's `[@slideIn]` hook had no `animations: [...]` array backing it — Angular silently ignored. Removed. `@keyframes slideIn` in CSS also dropped (was dead code). If animation is desired later, it can be wired intentionally.

## 4. Token additions

Four new tokens added to [_tokens.scss](../../../Frontend/Hospital-Admin-Panel/src/styles/_tokens.scss):

| SCSS var | Hex | CSS custom prop | Semantic use |
|---|---|---|---|
| `$color-info-strong` | `#0e2970` (alias of `$color-brand-navy-700`) | `--color-info-strong` | "low" criticality indicator; keeps info in the navy family (per user guidance — no new color family) |
| `$color-info-bg` | `#e8f0fe` | `--color-info-bg` | Background tint for info surface |
| `$color-success-bg-subtle` | `#ecfaf2` | `--color-success-bg-subtle` | Connection-status success strip (too subtle for the saturated `--color-success-bg: #79cfa6`) |
| `$color-danger-bg-subtle` | `#ffeeee` | `--color-danger-bg-subtle` | Connection-status error strip (ditto for danger) |

Documented in [design-tokens.md §4 Feedback](../design-tokens.md), tagged *"Added in Sprint 3g; flagged for designer review."*

## 5. Hex-to-token mapping (13 hex → 4 new + 9 existing tokens)

| Hex | Replacement | Notes |
|---|---|---|
| `#28a745` | `var(--color-success-strong)` | "connected" green |
| `#dc3545` | `var(--color-danger-strong)` | "critical" / "disconnected" red |
| `#667eea / #764ba2` gradient | `var(--color-brand-navy-700)` solid | Panel header; matches MODAL 3a headers |
| `#333` | `var(--color-text-heading)` | Dark text |
| `#495057` | `var(--color-text-muted)` | Detail label (muted convention) |
| `#6c757d` (CSS) | `var(--color-text-muted)` | Muted text |
| `#f0f9ff` | `var(--color-success-bg-subtle)` | Connection success bg (new token) |
| `#fff5f5` | `var(--color-danger-bg-subtle)` | Connection error bg (new token) |
| `#f8f9fa` | `var(--color-surface-alt)` | Hover + detail bg |
| `#dee2e6` | `var(--color-border-input)` | Border separator |
| `white` (literal) | `var(--color-surface-card)` | Panel + indicator bg |
| `rgba(0,0,0,0.1–0.2)` shadows | `var(--shadow-elevation-1)` / `var(--shadow-elevation-2)` | Reuse existing shadow tokens |

TS hex (in `getCriticalityClass` → CSS classes, not inline):

| Level | Class | CSS color |
|---|---|---|
| critical | `crit-level-critical` | `var(--color-danger-strong)` |
| high | `crit-level-high` | `var(--color-warning-strong)` |
| low | `crit-level-low` | `var(--color-info-strong)` (new token) |
| default | `crit-level-default` | `var(--color-text-muted)` |

## 6. Accessibility plan

| Element | Attribute(s) | Behaviour |
|---|---|---|
| Outer `.critical-values-widget` | `role="region" aria-label="Critical value alerts"` | Landmark |
| Hover bell | `aria-label="Critical value alerts, {{unreadCount}} unread"`, `aria-expanded="{{showPanel}}"`, `aria-controls="critical-value-panel"` | State announced + linked |
| `.alert-panel` | `id="critical-value-panel" role="dialog" aria-modal="false" aria-label="Critical value alerts"` | Non-modal dialog semantics |
| `.alerts-list` container | `role="log" aria-live="assertive" aria-relevant="additions"` | SR announces additions even when panel is closed |
| Each `.alert-item` | `role="alert"` | Interrupt announcement per critical value (clinical severity warrants interrupt) |
| Dismiss / Clear-all / Reconnect buttons | Specific `aria-label` | e.g., `aria-label="Dismiss alert for {{testName}}"` |
| Mute toggle | `aria-pressed="{{muted}}"`, `aria-label="Mute critical value alert sound"` | Button-as-toggle |
| Keyboard | ESC → close panel + return focus to bell; Enter/Space on bell → open; panel-open focuses first interactive element | Explicit handlers |

## 7. Mount point

[app.component.html](../../../Frontend/Hospital-Admin-Panel/src/app/app.component.html) — inside the authenticated-user branch, after `<app-sidebar>` + `.content`, before the closing divs. Not rendered on `isLoginRoute()` / `isMaintenanceRoute()` / `isChannelRoute()` / `isOtChannelRoute()` / `isTherapyChannelRoute()` / `isHelpDesk()`. Effectively equivalent to "render only where the sidebar renders". `<p-toast>` (already globally mounted) remains as-is.

## 8. Test plan

### Component (~9 tests)
1. Mounts without errors (SSE subscription fires when `AuthServiceService.getUserId()` returns a value).
2. Does not subscribe when `getUserId()` returns null (guard path).
3. Renders bell + badge when `alerts.length > 0` and `unreadCount > 0`.
4. Panel closed by default; opens on bell click; `unreadCount` resets on open.
5. Panel closes on ESC keydown (document listener) and returns focus to bell.
6. Alert item applies correct `crit-level-*` class from `getCriticalityClass`.
7. `clearAlert(id)` removes from local `alerts` + calls `criticalValuesService.clearAlert(id)`.
8. Mute toggle persists to `localStorage['critical-values-muted']`; `playAlertSound` becomes a no-op when muted.
9. `prefers-reduced-motion` auto-mutes sound on init when no stored preference.

### Service (~2 tests)
10. `acknowledgeAlert(alertId, acknowledgedBy)` POSTs `/critical-values/alerts/:alertId/acknowledge` with the expected body.
11. `clearAlert(id)` and `clearAllAlerts()` update the BehaviorSubject state.

### Integration / round-trip (1 test)
12. Simulate the backend broadcast → component state update → user acknowledge → service POST. Uses a fake `EventSource` double (window stub) to dispatch a `critical-value` event; asserts the full chain.

Target: **12 tests**. SSE mocking is new to the frontend suite; budget 1–2 buffer.

## 9. NABH / compliance

- **COP.8 — Laboratory services** calls for "critical-value reporting to the treating clinician in a time-bound, tracked manner". This sprint provides the UI surface for that reporting; the backend (Sprint 2.5 Part B) already does the broadcast; acknowledgment is tracked by `alertAcknowledgments` in memory server-side.

## 10. Out of scope (per Step 0 approvals)

- SSE exponential backoff (Q8 deferred to Sprint 4). Current 5s fixed reconnect stays.
- Banner rewrite (Option B) — approved as widget (Option A). No template shape change beyond a11y + tokens + mute toggle.
- Sound file / alert audio asset — current `playAlertSound` uses Web Audio API inline (no external asset); not revisiting.

## 11. Files that will change

**Modified:**
- `src/styles/_tokens.scss` — 4 new tokens (SCSS + `:root` exposure)
- `docs/design-tokens.md` — document the 4 new tokens (designer-review flag)
- `src/app/services/critical-values-alert/critical-values-alert.component.{ts,html,css,spec.ts}` — all three files touched; spec new (no existing spec)
- `src/app/services/critical-values.service.spec.ts` — new file (no existing spec)
- `src/app/app.module.ts` — declare `CriticalValuesAlertComponent`
- `src/app/app.component.html` — mount `<app-critical-values-alert>` in auth shell
- `docs/sprint-3-backlog.md` — Q8 deferral (SSE exponential backoff)
- `docs/modules/critical-values-banner-sync.md` (new)
- `docs/modules/critical-values-banner-parity.md` (new)
