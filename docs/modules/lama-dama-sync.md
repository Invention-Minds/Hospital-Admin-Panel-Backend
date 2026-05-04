# Sprint 2f — LAMA / DAMA · Sync Check

Backend-only. Verifies that the 4 LAMA/DAMA write endpoints push through the Sprint-1 wrapper on an **inline-await** timeline, persist `hmisLamaId`/`hmisDamaId`, and write `HmisAuditLog` rows on both outcomes.

Derived from the tests in [src/api/lama-dama/__tests__/lama-dama.test.ts](../../src/api/lama-dama/__tests__/lama-dama.test.ts).

## Wrapper-produced audit log — success row (createLamaRecord)

Captured `createHmisAuditLog` arguments when `pushLamaCase` resolves with `{ id: "HMIS-LAMA-7" }`:

```json
{
  "direction": "push",
  "module": "lama",
  "action": "lama_created",
  "payload": "<JSON of LamaRecord row: emergencyId, lamaTime, doctorAdvice, riskExplained, patientSignature, witnessName, witnessSignature, reasonForLama, hmisLamaId:null, createdBy, createdAt>",
  "response": "{\"entityType\":\"lama-record\",\"result\":{\"id\":\"HMIS-LAMA-7\"}}",
  "status": "success",
  "retryCount": 0
}
```

## Wrapper-produced audit log — failure row (createLamaRecord)

Captured when `pushLamaCase` rejects with axios-shape 400:

```json
{
  "direction": "push",
  "module": "lama",
  "action": "lama_created",
  "payload": "<JSON of LamaRecord row>",
  "response": "{\"entityType\":\"lama-record\",\"error\":{\"message\":\"bad request\",\"status\":400,\"detail\":{\"err\":\"missing field\"}}}",
  "status": "failed",
  "retryCount": 0
}
```

## Lifecycle-event audit rows (updates)

| Handler | Module | Action | Push method | Backfill behaviour |
|---|---|---|---|---|
| `updateLamaRecord` | `lama` | `lama_updated` | `pushLamaUpdate` | If `hmisLamaId` is null and HMIS returns an id → persist via 2nd `lamaRecord.update` call |
| `updateDamaRecord` | `dama` | `dama_updated` | `pushDamaUpdate` | Same pattern with `hmisDamaId` |

## Side effects — confirmed per endpoint

| Handler | Local DB mutation | HMIS push | Id persistence |
|---|---|---|---|
| `createLamaRecord` (happy) | LAMA create + Emergency.status='LAMA' | `pushLamaCase` | ✅ follow-up `lamaRecord.update` with returned id |
| `createLamaRecord` (failure) | LAMA create + Emergency.status='LAMA' | attempted, failed | ❌ no id to store; failure audit captures error |
| `createDamaRecord` (happy) | DAMA create + Emergency.status='DAMA' | `pushDamaCase` | ✅ follow-up update |
| `updateLamaRecord` (happy) | LAMA field update | `pushLamaUpdate` | ✅ backfilled via `persistHmisLamaIdIfMissing` when fixture.hmisLamaId is null |
| `updateDamaRecord` (happy) | DAMA field update | `pushDamaUpdate` | ✅ backfilled via `persistHmisDamaIdIfMissing` |

## Guards — confirmed

| Handler | Guard | Result |
|---|---|---|
| `createLamaRecord` | Missing `emergencyId` / `doctorAdvice` / `reasonForLama` | 400, no HMIS, no DB ✅ tested |
| `createLamaRecord` | Emergency not found | 404, no HMIS, no DB (legacy behaviour) |
| `createLamaRecord` | Duplicate LAMA for emergency | 400 (legacy status preserved per Sprint 2e precedent), no HMIS, no DB ✅ tested |
| `createDamaRecord` | Missing `emergencyId` / `doctorRecommendation` | 400, no HMIS, no DB ✅ tested |
| `createDamaRecord` | Duplicate DAMA for emergency | 400, no HMIS, no DB ✅ tested |
| `updateLamaRecord` | Prisma update throws (record not found) | 500, no HMIS ✅ tested |
| `updateDamaRecord` | Prisma update throws | 500, no HMIS ✅ tested |

## Read-endpoint contracts — confirmed

| Handler | Contract asserted |
|---|---|
| `getLamaRecord` | `findUnique where: { id }` + `include: { emergency: { select: prn, patientName, phoneNumber, presentingComplaint } }` |
| `getDamaRecord` | Same shape, DAMA-side |
| `getAllLamaRecords` | `findMany` with `include: { emergency: { select: prn, patientName } }` ordered `createdAt desc` |
| `getAllDamaRecords` | Same shape, DAMA-side |

All 4 read endpoints verified never to call `pushLama*` / `pushDama*` or `createHmisAuditLog`.

## Migration (applied this sprint)

- File: [prisma/migrations/20260418140000_add_hmisid_to_lama_and_dama_records/migration.sql](../../prisma/migrations/20260418140000_add_hmisid_to_lama_and_dama_records/migration.sql)
- SQL (2 additive `ALTER TABLE` statements):
  ```sql
  ALTER TABLE `DamaRecord` ADD COLUMN `hmisDamaId` VARCHAR(191) NULL;
  ALTER TABLE `LamaRecord` ADD COLUMN `hmisLamaId` VARCHAR(191) NULL;
  ```
- Preview used: `prisma migrate diff --from-schema-datasource ./prisma/schema.prisma --to-schema-datamodel ./prisma/schema.prisma --script` (NO `--shadow-database-url`). Output matched the migration file byte-for-byte.
- Apply: `prisma migrate deploy` — applied successfully, `_prisma_migrations` remained intact (159 rows after).
- Data-preservation: both are nullable ADD COLUMNs, metadata-only under MySQL 8.0+ INSTANT algorithm. No row rewrite, no lock, no data mutation. Every existing `LamaRecord`/`DamaRecord` row now has `hmisLamaId=NULL`/`hmisDamaId=NULL`.

---

# Sprint 3e — LAMA / DAMA Frontend · Sync surface

Frontend complement to the backend sync guarantees documented above. Verifies how the UI surfaces Sprint 2f's inline-await contract — specifically: the HMIS id populated on successful create/update, and the opportunistic backfill pathway when a create-time push failed.

## UI sync-state rendering

`HmisSyncIndicatorComponent` (extracted this sprint from the feature-local MLC implementation, now at [src/app/shared/ui/hmis-sync-indicator/](../../../Frontend/Hospital-Admin-Panel/src/app/shared/ui/hmis-sync-indicator/)) receives `hmisId` + `prefix` and renders:

| Record state | `hmisId` value | Rendered copy | Tokens |
|---|---|---|---|
| Create-time push succeeded | truthy | `Synced · HMIS-LAMA-{id}` / `Synced · HMIS-DAMA-{id}` | `--color-success-strong` + `pi-check-circle` |
| Create-time push failed (opportunistic backfill pending) | `null` | `Sync pending` | `--color-text-muted` + `pi-circle` |

The indicator is rendered:
- **List** (`LamaDamaComponent`, `size="small"`) — one cell per row in both LAMA and DAMA tables.
- **Detail** (`LamaDamaDetailComponent`, default size) — in the summary card, reflecting the current persisted id.

## Opportunistic backfill — UI round-trip

Sprint 2f's backend contract: if `updateLamaRecord` / `updateDamaRecord` is invoked on a record with `hmisLamaId=null` / `hmisDamaId=null`, the wrapper re-attempts the HMIS push; on success, `persistHmisLamaIdIfMissing` / `persistHmisDamaIdIfMissing` writes the id back via a second `lamaRecord.update` / `damaRecord.update`. The UI makes this observable:

1. User opens detail screen for a pending-sync record → indicator shows "Sync pending".
2. User clicks Edit → changes any field (often just triggering the save) → clicks Save.
3. `LamaDamaService.updateLama/DamaRecord` PUTs patch → backend succeeds → inside the same request, backend re-pushes and backfills the id.
4. `onUpdateSuccess` calls `loadRecord()` which re-fetches → indicator flips to "Synced · HMIS-LAMA-xxx".

Covered by [lama-dama-detail.component.spec.ts](../../../Frontend/Hospital-Admin-Panel/src/app/lama-dama/lama-dama-detail/lama-dama-detail.component.spec.ts):
> "enterEdit + saveEdit calls updateLamaRecord and reloads record (opportunistic backfill)"

This test uses `getLamaSpy.and.returnValues(initial /*null id*/, backfilled /*HMIS-LAMA-777*/)` to simulate the pre/post-backfill reads and asserts the component's `hmisId` getter flips accordingly.

## Write endpoints — frontend coverage matrix

| Service method | Route | UI entry point | Success toast | Test |
|---|---|---|---|---|
| `createLamaRecord` | `POST /lama-dama/lama` | Register (type=lama) → ConfirmDialog → `performSubmit` | "LAMA recorded" | register spec: LAMA submit navigates to `/lama-dama/lama/:id` |
| `createDamaRecord` | `POST /lama-dama/dama` | Register (type=dama) → ConfirmDialog → `performSubmit` | "DAMA recorded" | register spec: DAMA submit navigates to `/lama-dama/dama/:id` |
| `updateLamaRecord` | `PUT /lama-dama/lama/:id` | Detail (editing) → `saveEdit` | "LAMA record updated" | detail spec: opportunistic backfill |
| `updateDamaRecord` | `PUT /lama-dama/dama/:id` | Detail (editing) → `saveEdit` | "DAMA record updated" | detail spec: saveEdit error preserves editing state |

## Read endpoints — frontend coverage

| Service method | Route | UI consumer | Test |
|---|---|---|---|
| `getAllLamaRecords` | `GET /lama-dama/lama-list` | List → lamaRecords | service spec |
| `getAllDamaRecords` | `GET /lama-dama/dama-list` | List → damaRecords | service spec |
| `getLamaRecord` | `GET /lama-dama/lama/:id` | Detail on mount | detail spec (loads LAMA) + service spec (404 surfaces) |
| `getDamaRecord` | `GET /lama-dama/dama/:id` | Detail on mount | detail spec (loads DAMA) |
| `verifyDocumentation` | `POST /lama-dama/:type/:id/verify` | List verify-action | list spec (compliant → success toast; non-compliant → warn toast) — replaces pre-3e `alert()` |

## Error surface — preserves form state

`onCreateError` (register) and `onUpdateError` (detail) both:
- Show a PrimeNG error toast (severity=`error`, 6s life) derived from `err.error?.message ?? err.message`.
- Do **not** clear the form or navigate away — user can correct and retry.

Covered by register spec ("backend error surfaces toast and preserves form values") and detail spec ("saveEdit error preserves editing state and shows error toast").

