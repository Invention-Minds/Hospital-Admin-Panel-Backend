# Sprint 4a · Phase 1e — Bed Census Daily · Step 0 Audit

**Date:** 2026-04-20 · **Status:** Audit-only. Waiting on user approval of the schema / cron / auth / dashboard decisions before writing code.

---

## 0.1 Existing bed-census code — DOES exist (live reads only, no snapshots)

Three live endpoints in [ward-management.controller.ts](../../src/api/ipd/ward-management.controller.ts):

| Endpoint | Handler | What it returns |
|---|---|---|
| `GET /api/ipd/bed-census` (also mounted at `/api/ward/bed-census`) | `getBedCensus` | Per-ward array with `{ wardId, wardName, totalBeds, occupiedBeds, availableBeds, occupancyRate, beds: [...] }` — per-bed detail included. Accepts optional `?wardId=` for single-ward view. |
| `GET /api/ward/bed-census-report` | `getBedCensusReport` | Flat per-ward summary without bed-level detail — adds `maintenanceBeds`, `reservedBeds`, `department`, `wardCode`. |
| `GET /api/ward/bed-census-report/download` | `downloadBedCensusReport` | CSV export of the same shape. |
| `GET /api/ward/occupancy-trends?days=N` | `getOccupancyTrends` | Historical occupancy computed **on-demand** from `IpdAdmission.admissionDate` + `IpdDischarge.dischargeDate` for the last N days. |

**Net observation:** the live view is fully built. There's a proto-historical path via `getOccupancyTrends` but it **infers historical state from the admission/discharge timeline**, which cannot capture bed states like `maintenance` or `reserved` at a point in time. A snapshot table is still the right shape for NABH.

**Existing frontend:** [WardCensusComponent](../../../Frontend/Hospital-Admin-Panel/src/app/ward-management/ward-census.component.ts) at route `/ward-census` (authGuard-protected). Loads `getBedCensus` + `getWardStats` + auto-refreshes every 60s, supports CSV download. **No date picker.** There's also a `bed-census` subcomponent under `ward-management/bed-census/` — probably a detail/drill-down.

## 0.2 IpdBed state machine — 4 statuses observed

Grep of actual writes across controllers ([ward-management.controller.ts](../../src/api/ipd/ward-management.controller.ts), [ipd.controller.ts](../../src/api/ipd/ipd.controller.ts), conversion helpers):

| Status | Written by |
|---|---|
| `available` | bed create, reservation cancel, maintenance complete, discharge (via `bed.update` on discharge flow) |
| `occupied` | admission create, conversion helpers (opd-to-ipd, emergency-to-ipd) |
| `maintenance` | `markBedMaintenance` handler |
| `reserved` | `reserveBed` handler |

**No stray values.** Schema comment (`// available \| occupied \| maintenance \| reserved`) matches actual usage. 4 states exactly.

## 0.3 IpdWard structure + row count

Model at [schema.prisma:1418-1434](../../prisma/schema.prisma):
```prisma
model IpdWard {
  id          String   @id @default(uuid())
  wardName    String
  wardCode    String   @unique
  floor       String?
  department  String
  totalBeds   Int
  hmisWardId  String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  admissions  IpdAdmission[]
  beds        IpdBed[]
  @@index([wardCode])
  @@index([department])
}
```

**Dev DB row count: 2 wards, 6 beds, 1 active admission.** `wardCode` is `@unique`; `floor` is nullable; `department` is required string.

## 0.4 roomType vs bedType — two different taxonomies

**Important finding — they are NOT the same field:**

| Column | Lives on | Enum string values observed |
|---|---|---|
| `IpdBed.bedType` | physical bed classification | `general`, `ICU` (dev DB); schema: `general \| ICU \| HDU \| isolation` |
| `IpdAdmission.roomType` | admission-time room request | `general`, `ICU` (code); schema: `general \| semi-private \| private \| ICU \| HDU` |

The original 4a plan sketched `byRoomType: {general, semi-private, private, ICU, HDU}` — **that's the admission-side taxonomy**. But for a bed-census snapshot the right aggregation is **by bed classification** (`bedType`), since the snapshot is about the physical inventory, not who's currently in it.

**Proposed fix:** replace `byRoomType` with **`byBedType: {general, ICU, HDU, isolation}`** on the snapshot. If the user wants admission-side `roomType` aggregation too, that's a separate `byRoomType` field derived from active admissions via `bed.admissions[0].roomType`. I'll propose bedType-only for v1; roomType aggregation is a later superset if clinicians ask for it.

## 0.5 Cron infrastructure — recommend new file

`src/api/hmis-sync/hmis-sync.queue.ts` already hosts 4 crons: poll-lab (*/5), poll-radiology (*/5), sync-bed-availability (*/15), retry-failed (0 * * * *). Plus a stubbed retry (0 * * * *) that currently just logs.

The `sync-bed-availability` job is specifically about **pushing bed state to HMIS** — not about snapshotting. Conceptually different from bed census.

`src/api/ipd/follow-up-automation.ts` is also a separate cron file for a separate concern (reminders).

**Recommendation: new file `src/api/ipd/bed-census-snapshot.ts`** under the IPD module (same co-location pattern as follow-up-automation). Reasons:
- Bed census has zero HMIS-sync relationship — it's local operational record-keeping.
- Matches the existing "cron that serves one domain owns its own file" pattern (follow-up-automation.ts).
- Keeps `hmis-sync.queue.ts` focused on HMIS-sync concerns.

## 0.6 Admin role / access control — no existing pattern, recommend authenticateToken only

- JWT payload carries `{ id, username }` — no `role`.
- `UserRole` enum exists (`super_admin | sub_admin | admin | doctor | unknown`) but is NOT in the JWT.
- No `requireRole` or similar middleware anywhere in the codebase.

**Adding role-based middleware is a pattern-wide decision** that affects every sensitive endpoint — not a Phase 1e-scoped choice. Proposal: require **`authenticateToken` only** (any logged-in user can view the census). Rationale:
- Viewing bed census is operational awareness, not a write operation. Any staff member benefits from knowing ward capacity.
- Consistent with current system (no role-based guards exist today).
- Flag role-based guards as a Sprint 4b cross-cutting concern if NABH assessors demand admin-only census access.

**Flag for Sprint 4b:** "JWT payload carries no role; role-based authorization is impossible without a login-controller patch. If/when NABH requires admin-only endpoints, add role to JWT + build `requireRole(roles[])` middleware. Applies to all future access-controlled endpoints, not just bed census."

## 0.7 Schema proposal — per-ward rows

### Recommended shape

```prisma
model BedCensusSnapshot {
  id               Int      @id @default(autoincrement())
  snapshotDate     DateTime // Midnight UTC of the date captured (one logical "day")
  snapshotTime     DateTime @default(now()) // Actual clock time when snapshot was written

  // Ward-scoped — one row per ward per day
  wardId           String   // FK-shape pointer to IpdWard.id (loose, per existing pattern)
  wardName         String   // Denormalized for historical accuracy if a ward is later renamed/deleted
  wardCode         String   // Denormalized for historical accuracy
  department       String   // Denormalized

  // Bed counts (already computed server-side on snapshot generation)
  totalBeds        Int
  occupiedBeds     Int
  availableBeds    Int
  maintenanceBeds  Int
  reservedBeds     Int

  // Aggregation by bed classification (physical)
  byBedType        String   @db.LongText // JSON: { general: N, ICU: N, HDU: N, isolation: N }

  // Provenance
  snapshotReason   String   // 'cron' | 'manual' | 'recovery'
  createdById      Int?     // null for cron runs; populated for manual runs invoked via UI

  createdAt        DateTime @default(now())

  @@unique([snapshotDate, wardId])  // One snapshot per (date, ward) — blocks dup cron runs
  @@index([snapshotDate])
  @@index([wardId])
  @@index([snapshotReason])
}
```

### Per-ward rows vs aggregate — **my recommendation: per-ward rows**

Rationale:
- **Queryability** — "What was Ward B's occupancy on 2026-03-15?" is a direct lookup. With a JSON blob aggregate row we'd have to parse.
- **Historical-accuracy on ward rename/delete** — denormalized `wardName`/`wardCode`/`department` on each snapshot row captures what the ward was called at snapshot time. An aggregate blob would need the same but becomes awkward to maintain.
- **NABH filter shapes** — "Show me all ward-level snapshots where occupancy ≥ 90% in Q1" is a WHERE clause; with a blob it's a JSON path expression.
- **Row-count growth** — ~2 wards × 365 days = 730 rows/year. Even at 50 wards that's 18k rows/year. Trivial for MySQL.

Aggregate (day-summary) rows would be a **derived cheap SELECT** over the per-ward rows — no need to store separately. If anyone needs a "hospital-wide total on date X" it's a `SUM(totalBeds), SUM(occupiedBeds) WHERE snapshotDate = ?` one-liner.

### `snapshotReason` enum-by-convention

Plain String (consistent with existing `IpdBed.status` convention). Three values:
- `'cron'` — daily at midnight, the normal path
- `'manual'` — triggered via an admin UI button (not in Phase 1e; future)
- `'recovery'` — triggered programmatically to backfill a missed cron run (not in Phase 1e; documented for future)

### `createdById` vs `createdBy`

Per user's Phase 1e brief note:
> *"MRD attribution: BedCensusSnapshot rows have no user attribution. The cron is system-generated, manual runs can stamp createdById if invoked via UI. State the convention."*

- Cron runs: `createdById = null`, `snapshotReason = 'cron'`.
- Manual UI runs (future 4b+): `createdById = req.user.id`, `snapshotReason = 'manual'`.
- No `createdBy String?` — for a system-generated audit artifact, a typed id is sufficient; a parallel username column would be noise.

### Migration policy

Hand-written `migration.sql` with one `CREATE TABLE` statement. Additive (new table, no existing-row impact). No `--shadow-database-url`. Same verification pattern as Phase 1a.

## 0.8 Dashboard placement

**Existing:** [WardCensusComponent](../../../Frontend/Hospital-Admin-Panel/src/app/ward-management/ward-census.component.ts) at route `/ward-census` already displays the live ward census with auto-refresh + CSV download. **Extend it rather than create a new route.**

Proposed additions:
- Add a **date picker** above the ward table. Default: today (shows live data via `getBedCensus`).
- When user selects a historical date: switch to a NEW service call `getBedCensusSnapshot(date)` that reads from `BedCensusSnapshot`.
- If no snapshot exists for that date (e.g., cron missed that day): show an empty state "No snapshot for {date} — cron may not have run. Check the audit log."
- Historical mode → disable auto-refresh.
- Keep the "Download CSV" button (works on either live or snapshot data).

**Sidebar/menu:** no change needed. `/ward-census` is already accessible via whatever navigation already exposes it.

---

## Expected scope after this audit

1. **Backend:**
   - [migration.sql](#) — new `BedCensusSnapshot` table. 1 CREATE TABLE.
   - `src/api/ipd/bed-census-snapshot.ts` — new file:
     - `generateBedCensusSnapshot(reason, createdById?)` — reads current state, writes N ward rows in one transaction, emits audit log.
     - `initializeBedCensusCron()` — registers the daily midnight job.
   - `src/api/ipd/ward-management.controller.ts` — new handler `getBedCensusSnapshot(date)` reading from the snapshot table.
   - `src/api/ipd/ward-management.routes.ts` — new route `GET /api/ward/bed-census/snapshot?date=YYYY-MM-DD`.
   - `src/index.ts` — register the cron alongside the existing `initializeFollowUpReminders`.
2. **Frontend:**
   - `ward-census.component.ts` + `.html` — add date picker + historical mode toggle.
   - `ward-management.service.ts` — new method `getBedCensusSnapshot(date: string)`.
3. **Tests (6–10 target):**
   1. `generateBedCensusSnapshot` writes N ward rows with correct counts when invoked (verify shape of `byBedType` JSON).
   2. Cron callback invokes the generator.
   3. Dup-run safeguard: second same-day invocation errors or upserts (decision needed — see §Open question 1).
   4. `getBedCensusSnapshot(date)` returns rows for that date.
   5. `getBedCensusSnapshot(date)` with no rows returns empty array (not 404).
   6. Audit log written on success with module `'bed-census'`, action `'snapshot_created'`.
   7. Audit log written on failure with status `'failed'`.
   8. Frontend: date-picker change triggers `getBedCensusSnapshot` call.
   9. Frontend: "today" selection uses live `getBedCensus` (not snapshot).
   10. Frontend: no-snapshot empty state rendered correctly.

## Open questions for your approval

1. **Dup-run behavior on same-day re-invocation.** The `@@unique([snapshotDate, wardId])` constraint blocks duplicates. Two options:
   - **(a) Error on conflict** — cron only expects to run once per day; a second invocation is a bug. Log audit failure with reason `duplicate_snapshot_for_date`.
   - **(b) Upsert** — re-run overwrites earlier rows with fresh state. Lossy for audit (the first snapshot's state is lost), but resilient to cron hiccups.
   - **My lean: (a) error on conflict.** Snapshots are audit artifacts — immutable-once-written aligns with that. If a manual re-run is needed, that's `snapshotReason: 'recovery'` and can be a separate row.

2. **Midnight timezone.** The `snapshotDate DateTime` stores UTC. If we cron at `0 0 * * *` node-cron time, that's server-local midnight. User's hospital is India (IST = UTC+5:30). I'll use the server's local midnight (cron's native behavior) and store the resolved `DateTime`. Flag if you want explicit IST-anchored timestamps.

3. **`byBedType` JSON vs individual columns.** I proposed JSON for flexibility. Alternative: explicit `generalBeds`, `icuBeds`, `hduBeds`, `isolationBeds` columns. Tradeoff: queryability (SQL filters on specific types are easier with columns) vs extensibility (new bed types need a migration, not a JSON edit). Dev DB shows only 2 bed types in use today (`general`, `ICU`); small cardinality favors columns. **Alternative proposal: columns for the 4 known types + JSON `byBedType` also, as a canonical key-value record.** Over-engineered for v1. **Simplest: just the 4 columns, drop `byBedType` JSON.** Let me know which you prefer.

4. **Admin-only or any-authenticated?** Recommendation §0.6: any authenticated user. Alternative: gate behind role — but there's no role in the JWT today. Decision.

5. **Dashboard: extend `WardCensusComponent` vs create a new historical view?** Recommendation §0.8: extend. Alternative: keep today-view isolated, create `HistoricalCensusComponent` for the date-picker flow. **My lean: extend** (single screen, single mental model for users).

---

## Summary of decisions needed

| # | Question | My lean |
|---|---|---|
| 1 | Dup-run behavior on snapshot conflict | **(a) error** + audit log failure |
| 2 | Midnight timezone | server-local (cron default) |
| 3 | `byBedType` shape | **4 explicit columns** (general, icu, hdu, isolation), no JSON |
| 4 | Auth gate | **`authenticateToken` only** (any authenticated user) |
| 5 | Dashboard placement | **extend `WardCensusComponent`** with date picker |
| 6 | Cron placement | **new file `src/api/ipd/bed-census-snapshot.ts`** |
| 7 | Schema shape | **per-ward rows** (not aggregate) |

No execution until approved. Waiting.
