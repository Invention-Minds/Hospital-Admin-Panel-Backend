# Phase 1e — Daily Bed Census Snapshot · Sync Check

**Date:** 2026-04-20 · **Sprint:** 4a · Phase 1e.

Adds a persisted historical bed-census record so NABH MOM.4 / FMS.1 audit can
answer "what was the occupancy on date X?" The existing real-time `/bed-census`
endpoint queries `IpdBed.status` live — it cannot reconstruct past state.

---

## What runs now, end-to-end

```
00:05 (server local TZ) → node-cron tick
   ↓
registerBedCensusCron() → generateDailySnapshot('cron')
   ↓
   ├─ snapshotDate = new Date() normalized to local-midnight 00:00:00.000
   ├─ findMany BedCensusSnapshot where snapshotDate=today
   │     ├─ existing.length > 0 → audit('snapshot_dup_blocked','failed') + return duplicate-blocked
   │     └─ else continue
   ├─ ipdWard.findMany({ include: beds })
   ├─ build per-ward rows:
   │     status buckets  : occupied / available / maintenance / reserved (from IpdBed.status)
   │     type buckets    : general / ICU / HDU / isolation (from IpdBed.bedType, case-insensitive)
   │     identity        : snapshotReason='cron', createdById=null
   ├─ rows.length === 0 → audit('snapshot_generated','success', note='no-wards-defined') + return success(0)
   ├─ createMany(rows) → returns count (no ids on MySQL)
   ├─ findMany({ snapshotDate }) → collect created ids
   └─ audit('snapshot_generated','success', {wardCount, reason, createdById}) + return success(N, ids)
   (any throw) → audit('snapshot_failed','failed', {error}) + return failed
```

Manual / recovery invocations share the same path with reason='manual'|'recovery'
and an optional typed createdById (server-derived from JWT, never client body).

## HMIS audit log — new `module: 'bed-census'`

Registered in [hmis-sync-wrapper.ts HmisModule union](../../src/api/hmis-sync/hmis-sync-wrapper.ts).
Queryable via:

```sql
SELECT * FROM HmisAuditLog WHERE module = 'bed-census' ORDER BY createdAt DESC;
```

Actions emitted:

| Action | When | Status |
|---|---|---|
| `snapshot_generated` | Per-ward rows written (or zero-ward success) | `success` |
| `snapshot_dup_blocked` | Rows already exist for (today, wardId) — run rejected | `failed` |
| `snapshot_failed` | Unexpected throw during ward/bed fetch or write | `failed` |

The audit `payload` JSON always carries `snapshotDate`, `reason`, and the
relevant context (conflicting ward ids on dup-block, error message on failure,
ward count + createdById on success).

## BedCensusSnapshot — exact column contract

| Column | Value |
|---|---|
| `snapshotDate` | local-midnight (00:00:00.000) of the calendar day the snapshot represents. |
| `snapshotTime` | DB-default `CURRENT_TIMESTAMP(3)` — the exact time the row was written. |
| `wardId` / `wardName` / `wardCode` / `department` | denormalized from IpdWard at snapshot time. |
| `totalBeds` | IpdWard.totalBeds (planned capacity). |
| `occupiedBeds` / `availableBeds` / `maintenanceBeds` / `reservedBeds` | count of IpdBed rows per `status`. |
| `generalBeds` / `icuBeds` / `hduBeds` / `isolationBeds` | count of IpdBed rows per `bedType` (physical type). Case-insensitive match on 'ICU'/'icu', 'HDU'/'hdu'. |
| `snapshotReason` | `'cron'` | `'manual'` | `'recovery'`. |
| `createdById` | non-null only on manual/recovery runs. `'cron'` rows carry NULL (no human actor). |
| `createdAt` | DB default; typically equal to `snapshotTime`. |

Unique composite `(snapshotDate, wardId)` enforces one-row-per-ward-per-day.
A clinical restart safeguard: a `manual` invocation never clobbers a prior
`cron` row — it is rejected with `snapshot_dup_blocked`.

## Route contract

**`GET /api/ward/bed-census/snapshot?date=YYYY-MM-DD`**

- Middleware: `authenticateToken` (JWT required; follows Phase 1d server-
  derived-identity policy — the handler reads nothing from body/headers).
- 400: missing or malformed `date` query param.
- 404: no snapshot rows exist for the requested date.
- 200: `{ data: { date, snapshotTime, snapshotReason, wards: [...] } }` with
  per-ward aggregate rows (no per-bed detail — the snapshot is a summary).

## Server TZ pinning — operational note

`generateDailySnapshot` normalizes to **local** midnight, not UTC. This means
the server must run with `TZ=Asia/Kolkata` so `snapshotDate` lands on the
operational calendar day rather than drifting 5h30 into UTC yesterday/today.
Verify with `date` on the deployment host. Failure mode if misconfigured:
snapshots are still correct in data but keyed to the wrong calendar day,
which would cause the `(snapshotDate, wardId)` unique key to clash if the TZ
is later fixed.

## Manual-run evidence (dev DB, 2026-04-20)

Invoking `generateDailySnapshot('manual', 1)` on a 2-ward / 6-bed dev DB:

```
Pre-run: 2 wards, 6 beds.
Result: { status: 'success', wardCount: 2, rowIds: [1, 2] }

BedCensusSnapshot rows for 2026-04-20:
  SEED — General Ward (SEED-W-GEN) — total=4 occupied=1 available=3 maint=0 reserved=0 | general=4 icu=0 hdu=0 iso=0 | reason=manual createdById=1
  SEED — ICU (SEED-W-ICU) — total=2 occupied=0 available=2 maint=0 reserved=0 | general=0 icu=2 hdu=0 iso=0 | reason=manual createdById=1

Recent bed-census audit rows:
  id=1 action=snapshot_generated status=success

Re-invoking to verify idempotency: second result → duplicate-blocked
```

Confirms: ward-count parity, status + bed-type bucket separation, createdById
propagation, audit row emission, and same-day idempotency guard.

## Known Gaps at End of Phase 1e

1. **Snapshot rows carry no per-bed detail.** Historical views show
   ward-level aggregates only. Per-bed history (which bed was occupied by
   which admission on date X) is out of scope; the existing
   `IpdAdmission.admissionDate`/`IpdDischarge.dischargeDate` time-series
   answers that class of question.
2. **`generalBeds` + `icuBeds` + `hduBeds` + `isolationBeds` may not sum to
   `totalBeds`** when ward configuration includes bed-type values outside
   the expected four. This is by design — unknown-type beds count in
   `totalBeds`/status buckets but not in type buckets. Operator action
   items surface in the audit payload (`note='unknown-bed-types'`) —
   TODO for 4b if the gap appears in production.
3. **Backfill / recovery path is manual.** No dedicated `POST
   /ward/bed-census/recover` endpoint; an ops person triggers
   `generateDailySnapshot('recovery', userId)` via a script. Formal
   recovery endpoint deferred to 4b if a missed-day incident occurs.
4. **Cron retry on failure.** If the 00:05 tick fails (DB down), no
   retry is attempted until the next day. Same limitation as the
   existing follow-up reminder cron — tracked in 4b retry-cron scope.
