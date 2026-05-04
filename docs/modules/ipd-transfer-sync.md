# Sprint 2c — IPD Transfer · Sync Check

Backend-only. Verifies that `POST /api/ipd/admission/:admissionId/transfer` writes the expected `HmisAuditLog` row shape through the Sprint-1 wrapper on both outcomes, and that the three-op transaction (admission update + old-bed flip + new-bed flip) is atomic.

Derived from the happy-path + failure-path tests in [src/api/ipd/__tests__/ipd-transfer.test.ts](../../src/api/ipd/__tests__/ipd-transfer.test.ts).

## Wrapper-produced audit log — success row

Captured `createHmisAuditLog` arguments when `pushIpdTransfer` resolves with `{ id: "HMIS-TX-9" }`:

```json
{
  "direction": "push",
  "module": "ipd",
  "action": "bed_transfer",
  "payload": "<JSON.stringify of {admissionId, prn, fromBedId, toBedId, fromWardId, toWardId, reason}>",
  "response": "{\"entityType\":\"transfer\",\"result\":{\"id\":\"HMIS-TX-9\"}}",
  "status": "success",
  "retryCount": 0
}
```

## Wrapper-produced audit log — failure row

Captured `createHmisAuditLog` arguments when `pushIpdTransfer` rejects with axios-shape 503:

```json
{
  "direction": "push",
  "module": "ipd",
  "action": "bed_transfer",
  "payload": "<JSON.stringify of the transfer context>",
  "response": "{\"entityType\":\"transfer\",\"error\":{\"message\":\"Request failed with status 503\",\"status\":503,\"detail\":{\"err\":\"HMIS down\"}}}",
  "status": "failed",
  "retryCount": 0
}
```

## Transaction atomicity — confirmed

| Action | Happy path (HMIS 2xx) | Failure path (HMIS 503) |
|---|---|---|
| `prisma.$transaction` invoked | ✅ | ✅ |
| Inside tx: `ipdAdmission.update` (new bedId/wardId) | ✅ | ✅ |
| Inside tx: `ipdBed.update` on source bed → `available` | ✅ | ✅ (local state committed before HMIS attempt) |
| Inside tx: `ipdBed.update` on target bed → `occupied` | ✅ | ✅ |
| Post-tx: `ipdAdmission.update` with `hmisTransferId` | ✅ (when HMIS returns `id`) | ❌ (not called — no id to store) |
| Response code | 200 | 200 |
| Response body `data.hmisTransferId` | `"HMIS-TX-9"` | `null` |

## Guards — confirmed

| Input | Expected | Tested |
|---|---|---|
| Missing `newBedId` or `newWardId` | 400, no tx, no HMIS | ✅ |
| Admission not found | 404 (pre-existing, unchanged) | covered by pre-existing logic |
| Admission not in transferable state (`status !== 'admitted'`) | 409, no tx, no HMIS | ✅ |
| Target bed equals current bed (no-op) | 409, no tx, no HMIS | ✅ |
| Target bed occupied | 409, no tx, no HMIS | ✅ |

## hmis-sync.controller.ts cast cleanup — side audit

6 `(prisma as any)` casts removed. Two surfaced latent bugs that the casts hid:

| Line | Handler | Previous (broken) | Fixed as |
|---|---|---|---|
| 24 | `paymentConfirmedWebhook` | `(prisma as any).appointment?.update?.({ where: { id: parseInt(appointmentRef) } })` | `prisma.appointment.update({ where: { id: parseInt(appointmentRef) } })` — Int id, parseInt correct |
| 89 | `labResultReadyWebhook` | upsert with `where: { id: orderId }`, `as any` hid Int/string mismatch | `prisma.investigationResult.upsert` with `const oid = Number(orderId)` — upsert-by-id semantic bug flagged (not in 2c scope to fix) |
| 170 | `radiologyResultReadyWebhook` | same | same fix |
| 240 | `pharmacyDispensedWebhook` | `update` with non-existent `updatedBy` column, `as any` silently no-op'd | `prisma.prescription.findUnique` (no mutation — matches prior runtime behavior), comment notes a `dispensed` column is needed in a later sprint |
| 294 | `bedStatusUpdateWebhook` | **BUG**: `where: { id: parseInt(bedId) }` against UUID field → NaN → webhook silently broke | `prisma.ipdBed.update({ where: { id: String(bedId) } })` |
| 343 | `dischargeConfirmedWebhook` | **BUG**: same `parseInt(admissionId)` against UUID → NaN | `prisma.ipdAdmission.update({ where: { id: String(admissionId) } })` |

Net: 0 `(prisma as any)` remaining in `src/`. 2 pre-existing webhook bugs now fixed.

## Retry path

- Wrapper `maxRetries` default = 0.
- `hmis-client.retryRequest` still retries 3× (1/2/4s) inside `pushIpdTransfer`.
- On final failure, `HmisAuditLog.status = 'failed'` is written.
- Hourly `retryFailedSyncsJob` cron (Sprint 1-3 fix) re-attempts via `getFailedSyncs`.

No frontend sync check (frontend transfer UI not planned for Sprint 3 — already noted as ⚠️P in gap analysis).
