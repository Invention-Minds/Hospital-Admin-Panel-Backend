# Sprint 2b — IPD Discharge · Sync Check

Backend-only. Verifies that `POST /api/ipd/admission/:admissionId/discharge` writes the expected `HmisAuditLog` row shape through the Sprint-1 wrapper on both outcomes.

Derived from the happy-path + failure-path tests in [src/api/ipd/__tests__/ipd-discharge.test.ts](../../src/api/ipd/__tests__/ipd-discharge.test.ts).

## Wrapper-produced audit log — success row

Captured `createHmisAuditLog` arguments when `pushIPDDischarge` resolves with `{ id: "HMIS-DIS-4" }`:

```json
{
  "direction": "push",
  "module": "discharge",
  "action": "discharge_created",
  "payload": "<JSON.stringify of the full discharge row: admissionId, dischargeType, finalDiagnosis, dischargeSummary, medications, advice, followUpDate, ...>",
  "response": "{\"entityType\":\"discharge\",\"result\":{\"id\":\"HMIS-DIS-4\"}}",
  "status": "success",
  "retryCount": 0
}
```

Persisted HmisAuditLog shape (as Prisma inserts it):
- `id`: auto-increment PK
- `direction`: `push`
- `module`: `discharge`
- `action`: `discharge_created`
- `payload`: long-text JSON — full `IpdDischarge` row
- `response`: long-text JSON — `entityType: "discharge"` + `result` from HMIS
- `status`: `success`
- `retryCount`: 0
- `createdAt`: timestamp

## Wrapper-produced audit log — failure row

Captured `createHmisAuditLog` arguments when `pushIPDDischarge` rejects with axios-shape 500:

```json
{
  "direction": "push",
  "module": "discharge",
  "action": "discharge_created",
  "payload": "<JSON.stringify of the full discharge row>",
  "response": "{\"entityType\":\"discharge\",\"error\":{\"message\":\"Request failed with status 500\",\"status\":500,\"detail\":{\"err\":\"HMIS internal error\"}}}",
  "status": "failed",
  "retryCount": 0
}
```

## Discharge-row side effects — confirmed

| Action | Happy path (HMIS 2xx) | Failure path (HMIS 500) |
|---|---|---|
| `ipdDischarge.create` runs | ✅ | ✅ |
| `ipdAdmission.update` → `status: 'discharged'` | ✅ | ✅ |
| `ipdBed.update` → `status: 'available'` (plan step 8) | ✅ | ✅ (local side effects committed regardless of HMIS) |
| `ipdDischarge.update` with `hmisDischargeId` | ✅ (when HMIS returns `id`) | ❌ (not called — no id to store) |
| Follow-up auto-creation (if `followUpDate` set) | pre-existing — not built in 2b | pre-existing |
| Response code | 201 | 201 |
| Response body `data.hmisDischargeId` | `"HMIS-DIS-4"` | `null` |

## Guards — confirmed

| Input | Expected | Tested |
|---|---|---|
| Missing required field (`dischargeType`, etc.) | 400, no HMIS, no DB writes | ✅ |
| Admission already discharged (`status === 'discharged'`) | 409, no HMIS, no DB writes | ✅ |
| Existing `IpdDischarge` row for the admission | 409, no HMIS, no DB writes | ✅ |
| Admission not found | 404 (unchanged from pre-patch behavior) | covered by pre-existing not-found branch (no regression) |

## Field-by-field audit coverage

| Required field | Written? | Source |
|---|---|---|
| `direction: push` | ✅ | wrapper input |
| `module: discharge` | ✅ | wrapper input |
| `action: discharge_created` | ✅ | wrapper input |
| `payload` (full domain row as JSON) | ✅ | wrapper `safeStringify(input.payload)` |
| `response` on success (HMIS result) | ✅ | wrapper `safeStringify({ entityType, result })` |
| `response` on failure (status + body + message) | ✅ | wrapper `normalizeError` |
| `status: success \| failed` | ✅ | wrapper branches on `operation()` outcome |
| `retryCount` | ✅ | wrapper tracks attempts |
| Persisted even when HMIS throws | ✅ | wrapper never propagates (`swallowErrors` default true) |

## Retry path

- Wrapper `maxRetries` default = 0.
- `hmis-client.retryRequest` still retries 3× with 1/2/4s exponential inside `pushIPDDischarge`.
- On final failure, `HmisAuditLog.status = 'failed'` is written.
- The hourly `retryFailedSyncsJob` cron (Sprint 1-3 fix: `0 * * * *`) re-attempts via `getFailedSyncs`.

---

# Sprint 3b — Frontend sync check

Every form control in `IpdDischargeComponent` maps to exactly one backend field. The table below is the authoritative contract.

## Required form fields

| Frontend control | Backend field | Type | Validation | Notes |
|---|---|---|---|---|
| `dischargeType` | `dischargeType` | `'regular' \| 'LAMA' \| 'transfer' \| 'expired'` | `Validators.required` | 4 backend-supported values; DAMA intentionally excluded (its own flow) |
| `finalDiagnosis` | `finalDiagnosis` | `string` (LongText server-side) | `Validators.required` | Trimmed before submit |
| `conditionAtDischarge` | `conditionAtDischarge` | `string` | `Validators.required` | e.g. "Stable", "Improved" |
| `dischargeSummary` | `dischargeSummary` | `string` (LongText) | `Validators.required` | Trimmed before submit |

## Optional form fields

| Frontend control | Backend field | Type | Handling |
|---|---|---|---|
| `proceduresDone` | `proceduresDone` | `string?` | Empty-string → `undefined` before submit |
| `followUpDate` | `followUpDate` | `Date?` | `null` → not sent |
| `followUpDoctor` | `followUpDoctor` | `string?` | Empty-string → `undefined` |
| `advice` | `advice` | `string?` | Empty-string → `undefined` |
| `medications` (FormArray) | `medications` (array, server JSON-stringifies) | `Array<{name, dose, frequency, duration}>` | Empty rows filtered; values trimmed; `[]` is valid |

## Server-stamped fields (no frontend input)

- `dischargeDate` = `new Date()` at POST time
- `dischargeTime` = `new Date().toLocaleTimeString()` at POST time
- `createdBy` = `req.user.username` (AuthInterceptor attaches the JWT; backend stamps)
- `hmisDischargeId` = written on success; may be `null` if HMIS rejected

## Response-handling table

| Status | Backend payload | Frontend behaviour |
|---|---|---|
| 201 | `{ message, data: IpdDischarge }` including `hmisDischargeId?` | Success toast; toast body surfaces `hmisDischargeId` so QA can confirm HMIS sync; form marked pristine; navigate to `/ipd` |
| 400 | `{ message: 'Missing required fields: …' }` | Client validators mean this cannot normally fire; if it does, error toast shows the message, form preserved |
| 404 | `{ message: 'IPD admission not found' }` | Error toast; form preserved so user can investigate |
| 409 | `{ message: 'Admission is already discharged' }` or `{ message: 'Discharge record already exists for this admission' }` | Error toast with backend's message; form preserved |
| 500 | `{ message, error }` | Error toast; form preserved for retry |

All error responses route through `toErrorMessage()` which safely extracts `err.error.message`, `err.message`, or falls back to `'Unknown error'`. No `any` casts.

## Irreversible-action guard

The component inserts a ConfirmDialog between the submit click and the POST. `attemptDischarge()` never calls the service directly — it only sets `confirmDischargeVisible = true`. Only `onDischargeConfirm()` dispatches the HTTP request.

Dialog body text is explicit about the three server-side effects:
> "This will free the bed, mark the admission as discharged, and push the summary to HMIS. This action cannot be undone."

## HMIS round-trip visibility

On success, the frontend shows the `hmisDischargeId` in the toast. If HMIS failed (wrapper's `swallowErrors: true`), the backend still commits the discharge row but returns `hmisDischargeId: null`. Frontend degrades gracefully with a generic "Saved locally" message so the user knows the DB write succeeded but HMIS sync is pending (audit log row captures the failure; hourly retry cron picks it up).

## Known divergences

1. **DAMA excluded from the form** — documented in plan. User acknowledgment pending.
2. **`doctorSignature` field not collected** — backend schema doesn't have it yet. Carried forward in `GAP_ANALYSIS.md` Module 7a; schema patch scheduled for Sprint 4.
3. **Date picker popup visual** — PrimeNG defaults retained for the popup itself. Input anchor is tokenised. Flagged for designer.
4. **Dropdown option hover/selected** — narrow extrapolations documented in parity doc.
