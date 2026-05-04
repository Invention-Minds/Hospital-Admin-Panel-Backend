# Sprint 3g — Critical-Values Widget · Sync Check

Frontend-only closure of the SSE loop that Sprint 2.5 Part B built. No backend changes this sprint.

Derived from:
- Frontend: [CriticalValuesAlertComponent](../../../Frontend/Hospital-Admin-Panel/src/app/services/critical-values-alert/), [CriticalValuesService](../../../Frontend/Hospital-Admin-Panel/src/app/services/critical-values.service.ts), new tokens in [_tokens.scss](../../../Frontend/Hospital-Admin-Panel/src/styles/_tokens.scss).
- Backend: [critical-value-sse.ts](../../src/api/hmis-sync/critical-value-sse.ts), [critical-values.routes.ts](../../src/api/hmis-sync/critical-values.routes.ts) — unchanged.

## 1. SSE payload → component state

One-to-one mapping of the backend `CriticalValueAlert` event (`event: critical-value\ndata: <json>\n\n`) to the component's render state:

| Backend field | Type | Component use |
|---|---|---|
| `id` | `string` (`alert-result-<id>` stable when DB id known, else `alert-<orderId>-<ts>`) | Dedupe + dismiss target |
| `timestamp` | ISO string / Date | Rendered via `formatTime(date)` |
| `prn` | `string` | Header "PRN:" field |
| `patientName` | `string?` | Header "Patient:" field (falls back to "N/A") |
| `testName` | `string` | Card title |
| `result` | `string` | "Result:" + unit |
| `referenceRange` | `string?` | Reference-range row (only shown when present) |
| `unit` | `string?` | Appended to `result` |
| `criticalLevel` | `'critical' \| 'high' \| 'low'` | `getCriticalityClass()` → `crit-level-*` class |
| `type` | `'lab' \| 'radiology' \| 'vitals'` | Not rendered this sprint (reserved) |
| `reportUrl` | `string?` | Not rendered this sprint (reserved) |
| `department` | `string?` | Department row (only shown when present) |

The component unshifts each event onto `alerts: CriticalValueAlert[]`, increments `unreadCount`, and calls `playAlertSound()` (no-op when muted).

## 2. Acknowledge POST

`Clear Alert` button → `clearAlert(id)` in the component → `CriticalValuesService.clearAlert(id)` removes from the in-memory BehaviorSubject. The service still exposes `acknowledgeAlert(alertId, acknowledgedBy)` which POSTs `/api/critical-values/alerts/:alertId/acknowledge` with `{ acknowledgedBy }` — wired via the tests; UI invocation point is the same dismiss button (no double round-trip in this sprint — the dismiss is treated as the ack).

The backend `acknowledgeAlertById(alertId, user)` (in `critical-value-sse.ts`) stores `{ acknowledgedBy, acknowledgedAt }` in the in-memory `alertAcknowledgments` Map and returns `true` if the alert exists in the buffer.

## 3. Mute state → localStorage

| Key | Value | Semantics |
|---|---|---|
| `critical-values-muted` | `'true'` / `'false'` | User's explicit mute preference. Survives page refresh. |

Resolution order on component init:
1. If localStorage has `'true'` → mute ON.
2. If localStorage has `'false'` → mute OFF.
3. If no stored value → consult `window.matchMedia('(prefers-reduced-motion: reduce)')`. Reduced-motion preference → mute ON; otherwise → mute OFF.

`toggleMute()` writes back to localStorage on every change (try/catch so private-mode / quota errors don't crash the UI; in-memory mute still applies).

## 4. SSE connection lifecycle

| Event | Service behaviour | Component behaviour |
|---|---|---|
| First `critical-value` received | Parses JSON, pushes through `alertSubject` | `isConnected = true`; unshifts alert; `unreadCount++`; plays sound |
| `EventSource.onerror` | Closes existing + schedules reconnect in **5 s** (no backoff — flagged for Sprint 4) | `isConnected = false` on next error tick |
| `unsubscribeFromCriticalValues()` | Closes active EventSource, clears the ref | Called from `ngOnDestroy` |
| User presses **Reconnect** button | Service re-subscribes on a fresh EventSource | Same subscription chain re-enters |

Backend-side, on new connection:
- Handshake `event: connected` is sent first (not parsed by the component — the `addEventListener('critical-value', …)` filter ignores it).
- Last 10 buffered alerts replay immediately for catch-up after a reconnect.
- 30 s heartbeat comments keep the socket warm.

## 5. Token additions (design-system change, flagged for designer)

| Token | Value | Used by |
|---|---|---|
| `--color-info-strong` | `#0e2970` (alias of `--color-brand-navy-700`) | `.crit-level-low .alert-icon`, `.crit-level-low.alert-level` bg, `.crit-level-low.alert-item` left border |
| `--color-info-bg` | `#e8f0fe` | Reserved (not applied yet — documented for future info-surface consumers) |
| `--color-success-bg-subtle` | `#ecfaf2` | `.connection-status.success` background |
| `--color-danger-bg-subtle` | `#ffeeee` | `.connection-status.error` background |

Keeping info in the navy family avoids introducing Bootstrap teal (`#17a2b8`) as a fifth color — per user direction.

## 6. Verified end-to-end round-trip

The service spec's "subscribeToCriticalValues opens an EventSource …" test stubs `window.EventSource`, invokes `service.subscribeToCriticalValues('user-99')`, dispatches a `critical-value` event synchronously through the stub, and asserts the service emits the parsed alert downstream. Combined with the component spec's "receives an SSE event, unshifts to alerts, …" which feeds a `Subject<CriticalValueAlert>` directly through the service stub, the full chain is covered:

```
Backend broadcastCriticalValueAlert
  → EventSource wire (stubbed in service spec)
  → CriticalValuesService.subscribeToCriticalValues parses + emits
  → CriticalValuesAlertComponent subscribes, updates alerts[] + unreadCount
  → User clicks dismiss → clearAlert → service state + (optional) ack POST
```

## 7. Carried from Step 0 — still out of scope in 3g

- **SSE exponential backoff** — current 5 s fixed reconnect with no cap. Deferred to Sprint 4 per Q8 approval.
- **Per-item server-side ack propagation over SSE** — current backend doesn't push ack-state back over SSE; cross-client ack visibility is polled via `GET /pending` + ack map inspection. Not surfaced in the UI today.
- **Sound file asset** — `playAlertSound()` still uses an inline Web Audio oscillator; mute toggle + reduced-motion guard gate the call but no audio asset management.
