# Bed Census Daily · Frontend/Backend Parity

**Date:** 2026-04-20 · **Sprint:** 4a · Phase 1e.

Parity contract between the Angular `WardCensusComponent` and the backend
`GET /api/ward/bed-census/snapshot` + `generateDailySnapshot` surface.

---

## Wire contract

| Endpoint | Frontend caller | Shape |
|---|---|---|
| `GET /api/ward/bed-census` (live) | `WardManagementService.getBedCensus()` | `{ message, data: [{ wardId, wardName, totalBeds, occupiedBeds, availableBeds, occupancyRate, beds[] }] }` |
| `GET /api/ward/stats` (live agg) | `WardManagementService.getWardStats()` | `{ message, data: { totalWards, totalBeds, occupiedBeds, availableBeds, maintenanceBeds, reservedBeds, occupancyRate } }` |
| `GET /api/ward/bed-census/snapshot?date=YYYY-MM-DD` | `WardManagementService.getWardCensusSnapshot(date)` | `{ message, data: { date, snapshotTime, snapshotReason, wards: [...] } }` |

The snapshot endpoint requires `authenticateToken` — the frontend already
attaches JWT to every HTTP request via the `tokenInterceptor`; no component-
level change needed.

## Component state / mode switching

| State | `live` | `snapshot` |
|---|---|---|
| Trigger | Selected date = today | Selected date = past date |
| Primary fetch | `getBedCensus()` + `getWardStats()` | `getWardCensusSnapshot(YYYY-MM-DD)` |
| Auto-refresh (60s interval) | Enabled (user-toggleable) | Suppressed — `refresh()` gate: `mode !== 'live'` short-circuits |
| Per-bed grid | Rendered from `ward.beds[]` | Empty (snapshot carries aggregates only) |
| Header subtitle | "Live occupancy … 60 seconds" | "Historical snapshot as of {HH:MM} · reason: {reason}" |
| CSV export button | Visible | Hidden (no historical-CSV path in 4a) |

Mode is re-evaluated on every `(onSelect)` fire from `<p-calendar>`. The
component uses `isSameDay(selected, today)` rather than string-equality on
`YYYY-MM-DD` to stay TZ-consistent with the backend's local-midnight key.

## 404 handling

Snapshot-missing days return HTTP 404 → component sets `snapshotMissing=true`
→ empty-state banner reads "No bed census snapshot was recorded for this date."
The header action row keeps the calendar + Refresh button visible so the user
can pick another date without reloading the route.

## Data-shape normalization

The snapshot endpoint returns richer per-type fields (`generalBeds`, `icuBeds`,
`hduBeds`, `isolationBeds`) that the live endpoint does not provide. The
component normalizes snapshot rows down to the `BedCensus` interface used by
the live template (dropping type buckets, dropping `beds[]`) so the ward-card
template works unchanged in both modes. Exposing per-type buckets in the UI
is a 4b follow-up.

## Stats-card derivation

In `live` mode, stats come from `GET /api/ward/stats`. In `snapshot` mode,
the backend response does not include an aggregate envelope, so the component
derives `{totalWards, totalBeds, occupiedBeds, availableBeds, maintenanceBeds,
reservedBeds, occupancyRate}` locally from the returned `wards[]`. Both paths
produce identical fields for the header card grid.

## `maxDate` bound

The calendar is bounded `maxDate = today` — users cannot navigate into the
future. Prevents a confusing 404 on, e.g., 2027-01-01 and avoids leaking the
"this is a backed-by-snapshot table" implementation detail through a date the
backend would reject anyway.
