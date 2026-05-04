# Sprint 2a — IPD Admission · Sync Check

Backend-only. Verifies that `POST /api/ipd/admission` writes the expected `HmisAuditLog` row shape through the Sprint-1 wrapper on both outcomes.

Derived from the happy-path + failure-path tests in [src/api/ipd/__tests__/ipd-admission.test.ts](../../src/api/ipd/__tests__/ipd-admission.test.ts).

## Wrapper-produced audit log — success row

Captured arguments to `createHmisAuditLog` when `pushIpdAdmission` resolves with `{ id: "HMIS-ADM-7" }`:

```json
{
  "direction": "push",
  "module": "ipd",
  "action": "admission_created",
  "payload": "<JSON.stringify of the full admission row>",
  "response": "{\"entityType\":\"admission\",\"result\":{\"id\":\"HMIS-ADM-7\"}}",
  "status": "success",
  "retryCount": 0
}
```

Persisted HmisAuditLog shape (as the Prisma layer inserts it):
- `id`: auto-increment primary key
- `direction`: `push`
- `module`: `ipd`
- `action`: `admission_created`
- `payload`: long-text JSON string — includes admissionNo, prn, bedId, wardId, diagnosis, status
- `response`: long-text JSON string — `entityType: "admission"` + `result` from HMIS
- `status`: `success`
- `retryCount`: 0 (wrapper default; no retry needed)
- `createdAt`: timestamp

## Wrapper-produced audit log — failure row

Captured arguments to `createHmisAuditLog` when `pushIpdAdmission` rejects with an axios-shape 503:

```json
{
  "direction": "push",
  "module": "ipd",
  "action": "admission_created",
  "payload": "<JSON.stringify of the full admission row>",
  "response": "{\"entityType\":\"admission\",\"error\":{\"message\":\"Request failed with status 503\",\"status\":503,\"detail\":{\"err\":\"HMIS down\"}}}",
  "status": "failed",
  "retryCount": 0
}
```

Persisted HmisAuditLog shape:
- `status`: `failed`
- `response.error.status`: 503 (captured from axios `response.status`)
- `response.error.detail`: full HMIS error body (captured from `response.data`)
- `response.error.message`: original error message

## Sync check — field-by-field

| Required field | Written? | Source |
|---|---|---|
| `direction: push` | ✅ | wrapper input |
| `module: ipd` | ✅ | wrapper input |
| `action: admission_created` | ✅ | wrapper input |
| `payload` (full domain row as JSON) | ✅ | wrapper `safeStringify(input.payload)` |
| `response` on success (HMIS result) | ✅ | wrapper `safeStringify({ entityType, result })` |
| `response` on failure (error status + body + message) | ✅ | wrapper `safeStringify({ entityType, error })` via `normalizeError` |
| `status: success \| failed` | ✅ | wrapper branches on `operation()` outcome |
| `retryCount` | ✅ | wrapper tracks attempts |
| Persisted even when HMIS throws | ✅ | wrapper never propagates (`swallowErrors` default true) |

## Admission-row side effects — confirmed

| Action | Happy path (HMIS 2xx) | Failure path (HMIS 503) |
|---|---|---|
| `ipdAdmission.create` runs | ✅ | ✅ |
| `ipdBed.update` → `occupied` | ✅ | ✅ (bed still occupied — we don't roll back) |
| `ipdAdmission.update` with `hmisAdmissionId` | ✅ (when HMIS returns `id`) | ❌ (not called — no id to store) |
| Response code | 201 | 201 (admission created locally even if HMIS is down) |
| Response body `data.hmisAdmissionId` | `"HMIS-ADM-7"` | `null` |

## Retry path

- Wrapper `maxRetries` default = 0 (single attempt).
- `hmis-client.ts` internal retry (3×, 1s/2s/4s exponential) still runs inside `pushIpdAdmission`.
- If all 3 client-side retries fail, the wrapper's single attempt records `retryCount: 0` in the audit log (it only counts wrapper-level retries). The hourly `retryFailedSyncsJob` cron (Sprint 1-3 fix) picks up `HmisAuditLog.status = 'failed'` rows and re-attempts.

No frontend sync check (frontend IPD admission screen already exists per gap analysis and is out of Sprint 2 scope).
