# Sprint 2e — MLC · Sync Check

Backend-only. Verifies that the 4 MLC write endpoints push through the Sprint-1 wrapper on an **inline-await** timeline, persist `hmisMlcId`, and write `HmisAuditLog` rows on both outcomes.

Derived from the tests in [src/api/mlc/__tests__/mlc.test.ts](../../src/api/mlc/__tests__/mlc.test.ts).

## Wrapper-produced audit log — success row (registerMlcCase)

Captured `createHmisAuditLog` arguments when `pushMlcCase` resolves with `{ id: "HMIS-MLC-1" }`:

```json
{
  "direction": "push",
  "module": "mlc",
  "action": "mlc_registered",
  "payload": "<JSON of MlcCase row: mlcNo, emergencyId, caseType, policeStationName, fir_No, fir_Date, status, hmisMlcId:null, ...>",
  "response": "{\"entityType\":\"mlc-case\",\"result\":{\"id\":\"HMIS-MLC-1\"}}",
  "status": "success",
  "retryCount": 0
}
```

## Wrapper-produced audit log — failure row (registerMlcCase)

Captured when `pushMlcCase` rejects with axios-shape 503:

```json
{
  "direction": "push",
  "module": "mlc",
  "action": "mlc_registered",
  "payload": "<JSON of MlcCase row>",
  "response": "{\"entityType\":\"mlc-case\",\"error\":{\"message\":\"Request failed with status 503\",\"status\":503,\"detail\":{\"err\":\"HMIS down\"}}}",
  "status": "failed",
  "retryCount": 0
}
```

## Lifecycle-event audit rows (examination / samples / report)

Each PUT uses the shared `pushMlcUpdate` backend method with a discriminating `event` in the HMIS payload. Audit `action` differs per handler:

| Handler | Audit `action` | HMIS payload `event` |
|---|---|---|
| `recordExamination` | `mlc_examination` | `examination` |
| `recordSampleCollection` | `mlc_samples_collected` | `samples_collected` |
| `submitReport` | `mlc_report_submitted` | `report_submitted` |

All three share `module: 'mlc'` and `entityType: 'mlc-case'`.

## Side effects — confirmed per endpoint

| Handler | Local DB mutation | HMIS push | hmisMlcId persistence |
|---|---|---|---|
| `registerMlcCase` (happy) | create MlcCase | `pushMlcCase` | ✅ follow-up `mlcCase.update` with HMIS-returned id |
| `registerMlcCase` (failure) | create MlcCase | attempted, failed | ❌ (no id to store — failure audit captures it) |
| `recordExamination` (happy) | update examination fields + status='examination-done' | `pushMlcUpdate({event:'examination'})` | ✅ backfilled via `persistHmisMlcIdIfMissing` helper when previously null |
| `recordSampleCollection` (happy) | update sample fields + status='samples-collected' | `pushMlcUpdate({event:'samples_collected'})` | ✅ backfill helper |
| `submitReport` (happy) | update report fields + submissionDate + status='report-submitted' | `pushMlcUpdate({event:'report_submitted'})` | ✅ backfill helper |

The `persistHmisMlcIdIfMissing` helper is the design tool that lets subsequent lifecycle pushes recover from a register-time HMIS failure: if `hmisMlcId` is still null on the row AND the current push returns an id, write it. This removes the need for a manual reconciliation step.

## Guards — confirmed

| Handler | Guard | Result |
|---|---|---|
| `registerMlcCase` | Missing emergencyId or caseType | 400, no HMIS, no DB |
| `registerMlcCase` | Emergency not found | 404, no HMIS, no DB |
| `registerMlcCase` | Duplicate MLC for emergency | 400 (legacy status preserved), no HMIS, no DB ✅ tested |
| `recordExamination` | Prisma update throws (MLC not found) | 500, no HMIS ✅ tested |
| `recordSampleCollection` | Prisma update throws | 500, no HMIS ✅ tested |
| `submitReport` | Missing finalReport | 400, no HMIS, no DB ✅ tested |

## Retry path

- Wrapper `maxRetries: 0` (default).
- `hmis-client.retryRequest` retries 3× exponential (1s/2s/4s) inside every `pushMlc*` call.
- On final failure, `HmisAuditLog.status = 'failed'` row is written.
- Hourly `retryFailedSyncsJob` cron (Sprint 1-3 fix) re-attempts via `getFailedSyncs`.

## Migration (applied this sprint)

- File: [prisma/migrations/20260418120000_add_hmismlcid_to_mlc_case/migration.sql](../../prisma/migrations/20260418120000_add_hmismlcid_to_mlc_case/migration.sql)
- SQL: `ALTER TABLE \`MlcCase\` ADD COLUMN \`hmisMlcId\` VARCHAR(191) NULL;` — additive only.
- Preview command used: `prisma migrate diff --from-schema-datasource ./prisma/schema.prisma --to-schema-datamodel ./prisma/schema.prisma --script` (NO `--shadow-database-url`). Output matched the file byte-for-byte.
- Apply command: `prisma migrate deploy` — applied successfully, `_prisma_migrations` remained intact (158 rows after).
- Data-preservation: nullable ADD COLUMN is metadata-only in MySQL 8.0+ (INSTANT algorithm). No row rewrite, no table lock, no data mutation. Every existing `MlcCase` row now has `hmisMlcId = NULL`.

---

# Sprint 3d — Frontend sync check

Three screens — Register (Screen A), Detail (Screen B), List (Screen C enhanced). Every UI field maps to an exact backend field. Patient context always via `emergency.prn → PatientDetails`.

## Screen A — Register (`/mlc/new`)

### Field → backend mapping

| Form field | Validation | Sent as | Notes |
|---|---|---|---|
| Emergency case ID | `Validators.required`; read-only when `?emergencyId=<id>` is present | `emergencyId: string` | Backend parses to Int |
| Case type | `Validators.required`; dropdown | `caseType: 'accident' \| 'assault' \| 'poison' \| 'burn' \| 'other'` | |
| Police station | optional | `policeStationName` | `.trim() \|\| undefined` |
| FIR number | optional | `fir_No` | `.trim() \|\| undefined` |
| FIR date | optional; PrimeNG calendar | `fir_Date: Date \| undefined` | Backend converts to `new Date()` |

### Action → endpoint

| Action | HTTP | Endpoint | Response shape |
|---|---|---|---|
| Submit | `POST` | `/api/mlc/register` | `201 { message, data: { ..., hmisMlcId? } }` — inline-await; `hmisMlcId` present if the register push succeeded |
| Cancel | — | — | router → `/mlc` |

### Inline-await UX

- Save button disabled + label `"Registering…"` while awaiting (`submitting = true`).
- Success → navigate to `/mlc/:id` (uses `data.id` from response). The detail screen then shows the sync indicator reflecting `hmisMlcId`.
- Error → toast with `err.error.message`, form values preserved.

### Emergency pre-fill path

When `?emergencyId=<id>` is present, the component fetches `GET /api/emergency/:id` directly (via `HttpClient` — no dedicated EmergencyService method for by-id exists yet). The response's `patientName`, `prn`, `age` hydrate `<app-page-header>` and a `data-testid="emergency-context"` hint beneath the (now read-only) Emergency ID input.

## Screen B — Detail (`/mlc/:id`)

### Read path

`GET /api/mlc/:id` — the backend's response already includes the `emergency` join (`{ prn, patientName, phoneNumber, age, presentingComplaint }`). Patient details are additionally fetched via `AppointmentConfirmService.getDetailsByPRN(prn)` so the heading matches the canonical PatientDetails row (NABH MRD.1 — use the authoritative patient table).

### Sections

| Section | Backend field read | Backend endpoint (write) | Required fields | Notes |
|---|---|---|---|---|
| Case summary | `mlcNo, caseType, status, policeStationName, fir_No, fir_Date, emergency.presentingComplaint, hmisMlcId` | — (read-only) | — | Sync indicator derives from `hmisMlcId` |
| Examination | `examinerName, injuries, firstExaminationTime` | `PUT /api/mlc/:id/examination` | `examinerName, injuries` | Backend also accepts `examinerSignature, photographsTaken, photoUrls` — **not surfaced in v1** (file uploads scoped out — flagged) |
| Sample collection | `samplesCollected, sampleStorageInfo` | `PUT /api/mlc/:id/samples` | `samplesCollected` | `sampleStorageInfo` optional |
| Final report | `finalReport, reportSubmittedTo, submissionDate, status` | `PUT /api/mlc/:id/report` | `finalReport` | Form becomes read-only when `status ∈ { 'report-submitted', 'closed' }`; submission gated by P1 ConfirmDialog(severity=warning) |

### HMIS sync indicator

- `hmisMlcId` populated → `pi pi-check-circle` icon, `--color-success-strong` color, text `"Synced · HMIS-MLC-xxx"`.
- `hmisMlcId` null → `pi pi-circle` icon, `--color-text-muted` color, text `"Sync pending"`.

Updates after every lifecycle submit: the component calls `loadCase()` on success, which re-fetches and re-renders. This is the surface for Sprint 2e's **opportunistic backfill** — if register-time HMIS push failed (null `hmisMlcId`) but examination-time push succeeded, the response will carry the newly populated `hmisMlcId` and the indicator flips to "Synced".

### Inline-await UX

- Each section's submit button shows `"Saving…"` while awaiting.
- Success → success toast + `loadCase()` refresh.
- Error → error toast with `err.error.message`, form values preserved.

## Screen C — List (`/mlc`) enhancements

- **Pending-reports badge**: `GET /api/mlc/pending-reports` returns `{ data: [...], count: N }`; frontend reads `count` (falls back to `data.length` if absent).
- **"New MLC Case" button**: `router.navigate(['/mlc/new'])`.
- **Row click**: `router.navigate(['/mlc', c.id])`; `$event.stopPropagation()` on per-row action buttons so they don't double-fire navigation.
- **Close case**: replaced `prompt()` with P1 ConfirmDialog (severity=warning). Backend endpoint unchanged (`PUT /api/mlc/:id/close`). The closure-notes textarea that the old prompt captured is **not** surfaced in the new flow — `closureNotes` is always empty from the UI now. Flagged in parity §3 as a UX deviation.
- **Empty state**: replaced inline `<div class="empty-state">` with `<app-empty-state>`.

## Patient context path

Same as Sprint 3c: `emergency.prn → prisma.patientDetails.findUnique({ where: { prn } })` on the backend; frontend calls `AppointmentConfirmService.getDetailsByPRN(prn)`. No `Appointment.patientId` read. No direct read from `Patient`.

## Opportunistic-backfill verification

Detail component test 3 ("sync indicator updates after a lifecycle push") exercises this path end-to-end: first `getMlcCase` returns `hmisMlcId: null`, examination submit succeeds, second `getMlcCase` (from `loadCase()` refresh) returns `hmisMlcId: 'HMIS-MLC-999'`, component state flips `hmisSyncIsSynced` to `true`. This asserts Sprint 2e's helper is surfaced correctly in the UI.

## Known deviations from Sprint 3d brief

1. **Sample collection UI is two scalar text fields** (samplesCollected + sampleStorageInfo), not "array of samples with type, storageRef". Backend schema has two scalar columns, not an array. Flagged in parity §2.
2. **No examiner-signature or photograph upload UI** in v1. Backend endpoints exist (`POST /upload-signature`, `POST /upload-photos`) but the detail screen doesn't surface file-upload controls. Scope decision — flagged in parity §4.
3. **Close-notes textarea removed** (was in the old `prompt()` flow). P1 ConfirmDialog has no content slot for freeform input. Flagged in parity §3.
