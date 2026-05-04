# Sprint 4a · Phase 1d — Server-side Ack Wiring · Step 0 Audit

**Date:** 2026-04-20 · **Status:** Audit-only. Waiting on user approval of strategy before writing code.

---

## 0.1 Current dismiss button behavior

**Component:** [src/app/services/critical-values-alert/critical-values-alert.component.ts:102–105](../../../Frontend/Hospital-Admin-Panel/src/app/services/critical-values-alert/critical-values-alert.component.ts).

```ts
clearAlert(alertId: string): void {
  this.criticalValuesService.clearAlert(alertId);
  this.alerts = this.alerts.filter((a) => a.id !== alertId);
}
```

- Calls **`CriticalValuesService.clearAlert(alertId)`** — pure local state mutation ([service.ts:124–128](../../../Frontend/Hospital-Admin-Panel/src/app/services/critical-values.service.ts)): filters the BehaviorSubject array, emits the new array. **No HTTP call. No server contact.**
- Then removes from the component's local `this.alerts` array.
- **`acknowledgeAlert` is never invoked from anywhere in the component or the widget template.** The service method exists + is tested (Sprint 3g — 1 test), the backend endpoint exists + responds — the wire is simply unconnected.

## 0.2 `clearAllAlerts` behavior

- Component method ([component.ts:107–111](../../../Frontend/Hospital-Admin-Panel/src/app/services/critical-values-alert/critical-values-alert.component.ts)):
  ```ts
  clearAllAlerts(): void {
    this.criticalValuesService.clearAllAlerts();
    this.alerts = [];
    this.unreadCount = 0;
  }
  ```
- Service: same local-state-only pattern — clears the BehaviorSubject.
- **"Clear All" button exists in the panel footer** (seen in Sprint 3g template).
- **Backend has no batch-ack endpoint** — only the per-alert `POST /alerts/:alertId/acknowledge`. To ack N alerts we either (a) iterate N HTTP calls, (b) add a new batch endpoint, or (c) not ack individually and accept the audit gap for bulk dismissal.

## 0.3 `acknowledgedBy` identity source

**Service signature** (unchanged from Sprint 3g):
```ts
acknowledgeAlert(alertId: string, acknowledgedBy: string): Observable<any> {
  return this.http.post(`${this.apiUrl}/alerts/${alertId}/acknowledge`, { acknowledgedBy });
}
```

**Available identity sources on the frontend:**
- `localStorage.getItem('username')` — set on login
- `AuthServiceService.user?.username` — initialized from localStorage in `initializeUserFromStorage()`
- `AuthServiceService.getUserId()` — returns the numeric id
- There is no dedicated `getUsername()` method today, but the existing component already uses `AuthServiceService.getUserId()` for the SSE subscription — adding a tiny inline getter is the minimal pattern.

**Backend endpoint** ([critical-values.routes.ts:124–139](../../src/api/hmis-sync/critical-values.routes.ts)):
```ts
router.post('/alerts/:alertId/acknowledge', (req: Request, res: Response) => {
  const { alertId } = req.params;
  const { acknowledgedBy } = req.body;
  const user = acknowledgedBy || req.user?.username || 'system';

  const ok = acknowledgeAlertById(alertId, user);
  ...
});
```

**Two concerns:**

### Concern 1 — backend gap: endpoint has no `authenticateToken`

`req.user` is always `undefined` because the route is unauthenticated. Server-side identity derivation degrades to reading `acknowledgedBy` from the client-supplied request body, falling back to the literal string `'system'`.

For NABH MRD.1 this is a parallel to the IPD gap we closed in Phase 1b — **client-supplied attribution is equivalent to no attribution** because a determined client can self-report any username. Phase 1b's policy was "server-derived identity only"; this endpoint is the last place violating that.

### Concern 2 — in-memory ack store

`alertAcknowledgments: Map<alertId, {acknowledgedBy, acknowledgedAt}>` lives in [critical-value-sse.ts:24](../../src/api/hmis-sync/critical-value-sse.ts) — **in-memory only, lost on server restart**. Pre-existing from Sprint 2.5 Part B. NOT Phase 1d scope; flag for Sprint 4+ if persistent audit is needed (would require a DB table).

## 0.4 Failure mode policy

Per user's lean + mine: **dismiss locally regardless, toast the ack failure.**

```
clearAlert(id):
  1. disable the dismiss button (loading state)
  2. acknowledgeAlert(id, username).subscribe({
       next:  → remove from local state, enable button
       error: → remove from local state, toast "Alert dismissed locally — server couldn't be reached",
                enable button, audit gap accepted
     })
```

Rationale:
- The clinical event (clinician saw the alert and decided to dismiss) is real. Blocking dismissal on transient network issues means alerts pile up on the first poor-connectivity moment.
- The audit gap is limited to network-flake cases; the far more common path (ack succeeds + local dismiss) remains fully attributed.
- Keeping the alert in the UI on error forces the user to retry — bad UX for something they've already made a decision about.
- The retry path could be added later via the server-pull-from-buffer approach (the panel already replays the last 10 buffered alerts on reconnect via SSE).

**Alternative rejected:** keep alert in place on error. Worse UX; not aligned with the 3g widget's existing "dismiss is user-owned" semantics.

## 0.5 Ack state visibility pre-dismissal

- Widget does not distinguish "acknowledged by someone else" vs. "unseen" before dismissal.
- The backend's `/alerts` and `/pending` endpoints already enrich responses with `acknowledged: ack.has(a.id)` — visibility is a client-side choice.
- **Not Phase 1d scope.** Flag for 4c if cross-device ack visibility matters for clinical workflow. ("Another nurse already ack'd this — dismiss immediately or keep visible as a shared workspace item?")

---

## Decisions requiring your approval

### Q1 — Scope: frontend-only, or include the backend gap fix?

**Option (A) Frontend-only:** Send `acknowledgedBy: AuthServiceService.user?.username` from the client. Backend accepts as-is. Server-side identity-hardening ticket goes to Sprint 4b.

- Pros: matches the user's stated expected scope; tiny diff (1 component method, 1 service method adjustment if any).
- Cons: leaves the "client self-attributes" gap open. Equivalent audit-trail weakness to Phase 1b's pre-fix state.

**Option (B) Frontend + tiny backend patch:** Also add `authenticateToken` to just the `/alerts/:alertId/acknowledge` route + derive `acknowledgedBy` from `req.user!.username` server-side (drop the body field or treat it as ignored).

- Diff: ~5 LOC in [critical-values.routes.ts](../../src/api/hmis-sync/critical-values.routes.ts), 1 new backend test.
- Pros: closes the MRD-attribution gap consistently with Phase 1b. No "client self-attributes" loophole. Matches our Phase 1b-established pattern.
- Cons: mixes backend work into a frontend-scoped phase.

**My recommendation: (B).** Phase 1b established "server-derived identity" as the standard for every MRD-critical write path. Applying it to ack closes the gap uniformly; deferring means we leave a known weaker path until 4b. User policy: *"STOP and ask — backend work gets its own scope"* — I'm stopping here per that rule. If you prefer the stricter reading, we ship (A) and log the backend hardening into 4b; if you prefer coherent enforcement, we expand to (B).

### Q2 — Clear All behavior

**Option (i) Iterate:** `Promise.all(alerts.map(a => service.acknowledgeAlert(a.id, username)))` — each alert gets its own ack row on the server. N HTTP posts fire in parallel.

- Pros: complete audit trail; no new backend endpoint.
- Cons: N HTTP calls for large panels (unlikely >10 alerts in practice given the 10-alert SSE replay limit).

**Option (ii) Batch endpoint:** Add `POST /alerts/acknowledge-bulk` with `{ alertIds: string[] }` → single server round-trip, single aggregate audit row.

- Pros: fewer round-trips; single "bulk_clear" audit event.
- Cons: new backend endpoint = more backend scope than needed.

**Option (iii) Don't ack on bulk clear:** "Clear All" is pure local dismissal, no server ack.

- Pros: simplest; preserves current behavior.
- Cons: MRD gap — the clinician dismissed a batch of alerts and the server has no record.

**My recommendation: (i) iterate.** Simplest honest path. Typical ack-panel size is small (alerts < 10 in practice). If UX feels slow in production, (ii) batch is a Sprint 4+ optimization.

### Q3 — Rapid-dismiss race

Given the loading state (disabled button) during ack, rapid double-clicks are naturally debounced. **No additional guard needed.** Tests can cover.

### Q4 — Where does `acknowledgedBy` come from in Option (A)?

If we go (A), I propose: add a small `getUsername()` method on `AuthServiceService`:
```ts
getUsername(): string | null {
  return this.user?.username ?? localStorage.getItem('username');
}
```
Then component uses `const username = this.authService.getUsername() ?? 'anonymous';`.

If we go (B), the backend derives identity; frontend sends an empty body (or a placeholder ignored by the server).

### Q5 — Ack-in-flight UI state

Proposed: disable the `<button data-testid="dismiss-<id>">` while the Observable is pending. Re-enable on next/error. No spinner icon needed — the button briefly going disabled is enough visual feedback for a sub-500ms operation. Full PrimeNG loading spinner on the button is overkill.

---

## Proposed Phase 1d scope (pending decisions)

### Option A summary (frontend-only)

| File | Change |
|---|---|
| `critical-values-alert.component.ts` | `clearAlert`: call `acknowledgeAlert(id, username)`, handle error with local-dismiss + error toast. `clearAllAlerts`: iterate per alert. Add `ackInFlight: Set<string>` to disable buttons in flight. |
| `critical-values.service.ts` | Possibly keep as-is if we use the existing `acknowledgeAlert` method; otherwise add overload for identity resolution. |
| `auth-service.service.ts` | Add `getUsername()` method. |
| `critical-values-alert.component.spec.ts` | +4–6 new tests. |

**Estimate: ~50 LOC frontend diff + 6 tests. Zero backend changes.**

### Option B delta (additive)

| File | Additional change |
|---|---|
| `critical-values.routes.ts` | Add `authenticateToken` to the ack route; replace `acknowledgedBy || req.user?.username || 'system'` with `req.user!.username`. |
| New backend test | `ack endpoint returns 401 without token; succeeds with token; ignores client-supplied acknowledgedBy` — 2 tests. |
| `phase-1d-sync.md` | Document the auth addition. |

**Additional estimate: ~8 LOC backend + 2 tests.**

---

## Test plan (4–6 tests, per Q at top)

1. **Happy:** `clearAlert('alert-1')` calls `acknowledgeAlert('alert-1', 'alice')` → observable completes → alert removed from local state.
2. **Ack failure:** service throws 500 → alert STILL removed from local state + error toast shown via `MessageService`.
3. **In-flight button state:** during pending ack, the dismiss button for that alert is disabled; re-enabled on completion.
4. **Clear all — iterates:** 3 alerts → 3 `acknowledgeAlert` calls fire in parallel → all removed from local state.
5. **Clear all — partial failure:** 3 alerts, middle one fails → first + third removed via happy path, failed one still removed locally (per §0.4 policy) + error toast listing the failed id.
6. **(optional) Username sourcing:** component resolves `acknowledgedBy` from `AuthServiceService.getUsername()` (Option A) OR sends empty body (Option B).

If Option B is chosen, add 2 backend tests to the existing `hmis-sync-sse-wiring.test.ts` (or a new file) covering the auth enforcement on the ack route.

---

## Ask from you

1. **Q1 — Option A or B?** (My lean: B. Small backend patch closes the last MRD attribution gap.)
2. **Q2 — Clear All — iterate / batch / no-ack?** (My lean: iterate.)
3. Confirm test plan is reasonable at 4–6 frontend + possibly 2 backend = **6–8 total**.

No execution until decisions are in. Waiting.
