# Critical-Values Banner Step 0 Audit (Pre-Sprint-3g)

**Date:** 2026-04-20 · **Scope:** Read-only audit. No code changes. Purpose: decide placement, token mapping, and a11y plan before building.

---

## 1. Component location + declaration status

**Component exists:**
- [src/app/services/critical-values-alert/critical-values-alert.component.{ts,html,css}](../../../Frontend/Hospital-Admin-Panel/src/app/services/critical-values-alert/)

**Declaration status: orphaned.** `grep "CriticalValuesAlertComponent" src/app/` returns only its own component file. It is **not declared in `AppModule`** and not referenced anywhere in the app (no `<app-critical-values-alert>` usage). The selector is registered nowhere → no instance is ever mounted → SSE events are broadcast to zero clients.

The backing service ([critical-values.service.ts](../../../Frontend/Hospital-Admin-Panel/src/app/services/critical-values.service.ts)) is `providedIn: 'root'` and would work as soon as anything calls `subscribeToCriticalValues(userId)` — but nothing does.

## 2. SSE subscription pattern

### Frontend
[critical-values.service.ts:35-68](../../../Frontend/Hospital-Admin-Panel/src/app/services/critical-values.service.ts) uses **native `EventSource`** (not rxjs-websocket, not Socket.IO):

```ts
const sseUrl = `${apiUrl}/critical-values/stream?userId=${userId}`;
this.eventSource = new EventSource(sseUrl);
this.eventSource.addEventListener('critical-value', (event) => {
  const alert = JSON.parse(event.data);
  this.alertSubject.next(alert);
  // also maintains a BehaviorSubject list for history
});
this.eventSource.onerror = () => {
  this.eventSource?.close();
  setTimeout(() => this.subscribeToCriticalValues(userId), 5000); // auto-reconnect in 5s
};
```

The component subscribes via `criticalValuesService.subscribeToCriticalValues(this.userId).subscribe(alert => ...)`, tracking `isConnected` + `unreadCount` + alert list.

### Backend
[src/api/hmis-sync/critical-value-sse.ts](../../src/api/hmis-sync/critical-value-sse.ts) keeps an in-memory `Map<userId, Response[]>` of live SSE responses. On new connection:
- Writes `event: connected` handshake.
- Replays the last 10 buffered alerts (catch-up after reconnect).
- Starts a 30s heartbeat.

`broadcastCriticalValueAlert(alert)` iterates connections and writes `event: critical-value\ndata: <json>\n\n` to each. `createAlertFromInvestigationResult(row)` is the entry point from lab polling / webhook paths; it gates on `row.criticalFlag === true`, looks up patient name, infers `criticalLevel` from test-name heuristics, and calls broadcast.

Buffer size = 500 alerts. Acknowledgment state (`alertAcknowledgments: Map<alertId, {acknowledgedBy, acknowledgedAt}>`) is tracked in memory and exposed via the acknowledgment endpoint.

Routes in [critical-values.routes.ts](../../src/api/hmis-sync/critical-values.routes.ts):
- `GET /api/critical-values/stream?userId=…` — SSE subscription
- `GET /api/critical-values/active-users`
- `GET /api/critical-values/pending` (buffer)
- `GET /api/critical-values/alerts/:prn`
- `POST /api/critical-values/broadcast` (manual/test)
- `POST /api/critical-values/alerts/:alertId/acknowledge`

**No server-side ack propagation back over SSE** — acknowledgment is a standalone POST. The UI has a `clearAlert(id)` that POSTs to the ack endpoint (via service method) and optimistically removes from local state. Service method `acknowledgeAlert(alertId, acknowledgedBy)` already exists.

## 3. Current component shape — it's a FLOATING WIDGET, not a banner

The component today is designed as a **bottom-right floating bell + panel**, not a top banner:

```
┌────────────────────────────────────────────────┐
│  (page content — router-outlet)                │
│                                                │
│                              ┌──────────────┐  │
│                              │ [bell] Conn  │  │ ← fixed bottom-right
│                              └──────────────┘  │
│                              │ alert panel │←── toggle visibility
└────────────────────────────────────────────────┘
```

- `.critical-values-widget` is `position: fixed; bottom: 20px; right: 20px;`
- Click the bell → `togglePanel()` → `.alert-panel` expands above the bell
- Panel shows connection status, alert list, clear actions
- Bell carries a PrimeNG `[badge]` with `unreadCount`

It is NOT the banner UX suggested in the prompt ("above the router outlet") — it's a widget UX.

## 4. Placement proposal

Two paths — need user approval before building:

### Option A (my lean) — keep the floating widget, mount it globally in the app layout
Mount `<app-critical-values-alert>` inside `app.component.html` alongside `<p-toast>`, but **scoped to the authenticated-user shell** (inside the `<app-sidebar>`-wrapped branch). Appears on every doctor-facing screen. No layout surgery. Minor HTML addition + AppModule declaration.

Pros: matches component's existing design; zero CSS rewrite beyond the hex fixes; visible everywhere without occupying real estate until clicked.
Cons: not the "banner above router-outlet" pattern requested; click-to-open adds one interaction step.

### Option B — convert to above-router banner
Rewrite template + CSS: drop the bell/toggle, surface the newest unack'd alert as a strip at `top: 0; left: 0; right: 0` when `alerts.length > 0`. Auto-dismisses on acknowledge or user-dismiss.

Pros: zero-click visibility; matches the prompt's "above the router outlet" phrasing.
Cons: major template + CSS rewrite; loses the history panel unless we build a Dismissed/Acknowledged drawer; competes with `<p-toast>` for screen real estate.

### Option C — hybrid
Keep the widget as the "history + ack" affordance (no layout change), AND add a top banner that shows only the newest unack'd alert. Two surfaces for the same data; discoverability is best but code is highest.

**Recommendation: Option A.** The component is already built as a widget, works well, matches the `MessageService` toast/notification paradigm users already see on every screen, and needs only (declaration + mount + hex fix + a11y). Option B is a rewrite.

If the user prefers **Option B or C**, say so and I'll restructure the plan.

## 5. Hardcoded hex count — honest disclosure

The prompt said "4 hardcoded hex leaks." There are actually **many more** — **13 distinct hex values across CSS + TS**, with some repeated. Full enumeration:

### In `critical-values-alert.component.css`

| Hex | Purpose | Occurrences |
|---|---|---|
| `#28a745` | "connected" green (button bg/border, indicator, connection-status, empty-state icon) | 4 |
| `#dc3545` | "disconnected"/"critical" red (button bg/border, indicator, connection-status, result-value) | 5 |
| `#667eea #764ba2` | panel-header gradient | 1 pair |
| `#333` | heading/dark text | 2 |
| `#495057` | detail label | 1 |
| `#6c757d` | muted (alert-time, empty-state) | 2 |
| `#f0f9ff` | connection-status success bg | 1 |
| `#fff5f5` | connection-status error bg | 1 |
| `#f8f9fa` | alt surface (hover, details bg) | 2 |
| `#dee2e6` | border-bottom | 3 |
| `white` (literal) | panel bg + indicator bg | 2 |
| `rgba(0,0,0, 0.10–0.20)` | box-shadows | 3 |

### In `critical-values-alert.component.ts` (`getCriticalityColor()`)

| Hex | Level |
|---|---|
| `#dc3545` | critical |
| `#ffc107` | high |
| `#17a2b8` | low |
| `#6c757d` | default |

These are returned as strings and bound via `[style.color]` / `[style.background-color]` on `.alert-level`, the icon, and the border-left stripe. **Better approach:** return a CSS class name (`'crit-level-critical' | 'crit-level-high' | 'crit-level-low' | 'crit-level-default'`) and let CSS own the color. Want me to refactor the TS to class-based during the sprint?

## 6. Proposed token mapping

Existing tokens (from [_tokens.scss](../../../Frontend/Hospital-Admin-Panel/src/styles/_tokens.scss)):

| Hardcoded | Proposed token | Notes |
|---|---|---|
| `#dc3545` (critical) | `var(--color-danger-strong)` → `#d20006` | Close semantic match; slight hue shift |
| `#28a745` (connected/success) | `var(--color-success-strong)` → `#169458` | Close match |
| `#ffc107` (high/warning) | `var(--color-warning-strong)` → `#e9c400` | Close match |
| `#6c757d` (muted default) | `var(--color-text-muted)` → `#7b7b7b` | Close match |
| `#333` (dark text) | `var(--color-text-heading)` → `#271e4a` | Slight hue shift (navy-purple vs plain dark) |
| `#495057` (detail label) | `var(--color-text-muted)` | Label convention across Sprint 3 uses muted |
| `#f8f9fa` (alt surface) | `var(--color-surface-alt)` → `#f4f4f4` | Close match |
| `white` | `var(--color-surface-card)` → `#ffffff` | Exact match |
| `#dee2e6` (border) | `var(--color-border-input)` → `#bcbec0` | Darker than source — alternative: add lighter `--color-border-subtle` |

### Three hexes have no clean existing token match — I need decisions

| Hardcoded | Problem | Proposals |
|---|---|---|
| `#17a2b8` (info blue — "low" critical) | No `--color-info-*` tokens exist | **(a)** Add `$color-info-strong: #17a2b8` + `$color-info-bg: #cfeff4` to `_tokens.scss`. **(b)** Reuse `--color-text-accent` (existing, may drift). **(c)** Drop "low" as a distinct severity and fold it into warning. — Lean: **(a)** |
| `#f0f9ff` (connection success bg) | `--color-success-bg` is `#79cfa6` (badge saturation, too strong) | **(a)** Add `$color-success-bg-subtle: #ecfaf2`. **(b)** Reuse `--color-surface-alt` (loses green semantic). — Lean: **(a)** |
| `#fff5f5` (connection error bg) | `--color-danger-bg` is `#ff706f` (badge saturation, too strong) | **(a)** Add `$color-danger-bg-subtle: #ffeeee`. **(b)** Reuse `--color-surface-alt`. — Lean: **(a)** |
| `#667eea #764ba2` (panel-header gradient) | Gradients aren't tokenized; not part of the design system | **(a)** Replace with solid `var(--color-brand-navy-700)` (matches MLC/LAMA/DAMA/MODAL 3a headers across Sprint 3). **(b)** Keep gradient but define tokens for it. — Lean: **(a)** — unifies with the modal header pattern |

**If you approve the three new tokens (info-strong/bg-subtle + success-bg-subtle + danger-bg-subtle), I'll add them to `_tokens.scss`. That IS a design-system change; if you'd rather not extend the token set this sprint, Option (b) fallbacks are viable.**

## 7. Accessibility additions proposed

Current template has no a11y attributes. Additions for Sprint 3g:

| Element | Attribute | Purpose |
|---|---|---|
| `.critical-values-widget` (outer) | `role="region" aria-label="Critical value alerts"` | Landmark |
| Bell button | `aria-label="Critical value alerts, {{unreadCount}} unread"` `aria-expanded="showPanel"` `aria-controls="critical-value-panel"` | Announce unread count + state |
| `.alert-panel` | `id="critical-value-panel"` `role="dialog" aria-modal="false"` `aria-label="Critical value alerts"` | Dialog semantics without trap (non-modal) |
| Each new `.alert-item` (when rendered) | `role="alert"` (ephemeral announce) OR container `role="log" aria-live="assertive"` | **Decision needed:** `role="alert"` interrupts screen reader; `aria-live="assertive"` does same politely. Critical lab values → I lean `role="alert"` per-item so each new alert is announced. |
| Panel close / clear / ack buttons | `aria-label="Dismiss alert for {{testName}}"` etc. | Specific labels, not "×" |
| Bell | Keyboard: ESC closes panel when open; Enter/Space opens; Tab order: bell → reconnect → alert items → clear-all | Native + explicit |
| Alert sound (`playAlertSound()`) | Respect `prefers-reduced-motion` or add an in-app toggle | Sound on critical alert without user control is a regression risk |

Focus management:
- When panel opens → move focus to the first interactive element in the panel (e.g., first alert's "Dismiss" button).
- When panel closes → return focus to the bell.
- Multi-alert queue: `aria-live="assertive"` region mirrors new alerts (even when panel is closed) so screen readers get notified.

## 8. Other CSS housekeeping beyond the hexes

- `!important` usage on `.alert-button` properties (`width`, `height`, `border-radius`, `font-size`) — leftover from PrimeNG override battles. Can be dropped once we use `p-button-rounded` variant class properly.
- Custom `@keyframes slideIn` in both CSS and template's `[@slideIn]` animation hook, but the animation is not wired (no `animations: []` array in the component). Either wire it via Angular's `@Component({ animations: [...] })` or drop the reference.
- Touching the module declaration pulls the component's CSS into the test bundle — worth spot-checking for any other compile-blockers (learned from Sprint 3f's `:deep(...)` discovery in Emergency list).

## 9. Open questions for your approval

Numbered for easy reference:

1. **Placement** — Option A (floating widget, mount globally, no layout change) is my recommendation. Approve A, switch to B (banner rewrite), or C (hybrid)?

2. **TS getCriticalityColor → CSS class refactor** — change from hex-string returns to class-name returns so color lives in CSS? Clean long-term; ~30 lines of change across TS + template + CSS. Approve?

3. **Three new tokens** — `--color-info-strong`, `--color-info-bg`, `--color-success-bg-subtle`, `--color-danger-bg-subtle` (four actually, sorry for the §6 miscount). Add them? Or prefer Option (b) fallback reuse?

4. **Gradient → solid navy** for panel header — matches §3 MODAL 3a pattern used throughout Sprint 3. Approve?

5. **`role="alert"` per-item vs `aria-live="assertive"` container** — I lean per-item so each new critical alert gets its own announcement (matches clinical severity). Approve?

6. **Alert sound (`playAlertSound()`)** — add a user-toggle ("Mute alerts" checkbox in the panel header) + respect `prefers-reduced-motion` (treat as an accessibility signal for auto-mute)? Or leave sound unconditional?

7. **`@keyframes slideIn` / `[@slideIn]` animation mismatch** — drop the template binding (animation never fired), or wire it up via `animations: []`? Cosmetic.

8. **Scope for HTTP response handling** — current service's `onerror` auto-reconnects in 5s without capping retries. Under a persistent outage this spams the server. Add exponential backoff? (Small backend-friendly patch.) Or out of scope for 3g?

## 10. Recommended scope for Sprint 3g (per audit)

Build order, Option A assumed:

1. Add 4 new tokens to `_tokens.scss` (if §9.Q3 approved).
2. Refactor component TS to class-based `getCriticalityClass()` (if §9.Q2 approved).
3. Declare `CriticalValuesAlertComponent` in AppModule.
4. Mount `<app-critical-values-alert>` in `app.component.html` inside the authenticated-user branch (same stacking context as `<p-toast>`).
5. Replace all CSS hex + rgba shadow with tokens + token-based shadow utilities.
6. Add a11y attributes + focus management + ESC/Enter/Space handlers.
7. Wire the `[@slideIn]` animation or drop it.
8. Add mute-toggle + `prefers-reduced-motion` guard around `playAlertSound` (if §9.Q6 approved).
9. Tests (≈8–10):
   - Declares + mounts without errors; SSE subscription starts on init.
   - Renders bell + badge when `alerts.length > 0` + `unreadCount > 0`.
   - Panel opens on bell click; closes on ×, overlay, and ESC.
   - Alert item renders patient/test/result/reference range/timestamp; applies correct `crit-level-*` class.
   - `clearAlert(id)` removes it locally and hits the ack endpoint.
   - `clearAllAlerts()` resets state.
   - Reconnect button invokes `connectToAlerts`.
   - Service: `subscribeToCriticalValues` posts to correct URL + parses `critical-value` events; re-subscribes on error (5s).
   - A11y: `role="alert"` on new item; ARIA attributes on bell + panel.
10. End-to-end SSE round-trip test (more integration-flavored): backend `broadcastCriticalValueAlert` → mocked EventSource event dispatch → component state updates → user acknowledges → service.acknowledgeAlert POST fires.

## Appendix — Verification log

- Orphan confirmed: `grep "CriticalValuesAlertComponent" src/app/` → 1 match (component self-reference). Not in `app.module.ts` declarations.
- Existing widget design: `position: fixed; bottom: 20px; right: 20px;` in CSS line 1–6.
- Backend SSE is event-driven, not poll-based: `event: critical-value\ndata: <json>\n\n` format. Client uses `addEventListener('critical-value', …)`.
- Service's auto-reconnect: `setTimeout(..., 5000)` unconditional. No backoff.
- `getCriticalityColor()` returns hex strings inline to `[style.*]` bindings — no CSS coverage possible without TS change.
- Existing `--color-*` tokens: `surface-page/card/alt/overlay/glass-fill/glass-border/row-alt/table-head`, `text-heading/body/muted/accent/on-dark/placeholder`, `success-bg/success-strong`, `warning-bg/warning-strong`, `danger-bg/danger-strong`, `border-input/border-checkbox`, brand palette. **No info-* tokens.**
- Backend test coverage of SSE: `src/api/hmis-sync/__tests__/hmis-sync-sse-wiring.test.ts` exists (not read in detail).

Ready for your approval. Will STOP here until the 8 questions are decided.
