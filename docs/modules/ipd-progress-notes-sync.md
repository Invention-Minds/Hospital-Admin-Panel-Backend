# Sync Check — IPD Progress Notes

Sprint 3a-2. Every backend contract → frontend consumer verified.

## Backend endpoint contract vs frontend calls

### `POST /api/ipd/admission/:admissionId/progress-note`

Backend ([ipd.controller.ts:379-449](../../src/api/ipd/ipd.controller.ts)) request body:

| Field | Type | Required? | Frontend form control | Required client-side? |
|---|---|---|---|---|
| `doctorName` | string | **yes** | `doctorName` | `Validators.required` ✅ |
| `subjective` | string (LongText) | **yes** | `subjective` | `Validators.required` ✅ |
| `objective` | string (LongText) | **yes** | `objective` | `Validators.required` ✅ |
| `assessment` | string (LongText) | **yes** | `assessment` | `Validators.required` ✅ |
| `plan` | string (LongText) | **yes** | `plan` | `Validators.required` ✅ |
| `nursingNotes` | string? (LongText) | optional | `nursingNotes` | optional ✅ |
| `vitalsBP` | string? | optional | `vitalsBP` | optional ✅ |
| `vitalsHR` | string? | optional | `vitalsHR` | optional ✅ |
| `vitalsTemp` | string? | optional | `vitalsTemp` | optional ✅ |
| `vitalsSpO2` | string? | optional | `vitalsSpO2` | optional ✅ |
| `vitalsRR` | string? | optional | `vitalsRR` | optional ✅ |

Empty-string optionals are coerced to `undefined` by the component's `submit()` mapper before being sent, so the backend receives a clean record rather than empty strings. No unsent fields. No extra fields.

Backend URL param: `:admissionId` — read from `ActivatedRoute.snapshot.paramMap.get('admissionId')` in `ngOnInit`. If missing, submit is blocked and an error toast is shown.

### Response handling

| Status | Backend payload | Frontend behaviour |
|---|---|---|
| 201 | `{ message, data: progressNote }` | Success toast via `MessageService` (severity `success`, life 3000ms); form reset; list reloaded |
| 400 | `{ message: 'Missing required fields: …' }` | Client validators mean the form is disabled until all five are filled; if the backend still returns 400, error toast surfaces the payload message |
| 404 | `{ message: 'IPD admission not found' }` | Error toast |
| 500 | `{ message, error }` | Error toast |

All error responses route through `HttpErrorResponse.error.message` extraction in `toErrorMessage()` — no `any` casts, no silent swallowing.

### `GET /api/ipd/admission/:admissionId/progress-notes`

Backend ([ipd.controller.ts:453-487](../../src/api/ipd/ipd.controller.ts)) response shape:

```json
{
  "message": "Progress notes retrieved successfully",
  "data": [ IpdProgressNote, … ],
  "pagination": { "total": N, "page": 1, "limit": 10, "pages": M }
}
```

Frontend consumer: `IpdProgressNoteComponent.loadNotes()` calls `IpdService.getProgressNotes(admissionId)` and passes the raw response to `extractNotes(res)` which normalises both `{ data: [] }` and the raw array forms. **Pagination is not yet surfaced in UI** — first 10 entries shown. Pagination UI is gap #6 in ui-patterns.md, deferred until list-heavy modules arrive (likely Sprint 3c).

## NABH mapping

| NABH clause | Field | Where enforced |
|---|---|---|
| COP.2 — patient-reported history | `subjective` | `Validators.required` |
| COP.2 — observed findings | `objective` | `Validators.required` |
| COP.2 — clinical impression | `assessment` | `Validators.required` |
| COP.2 — plan of care | `plan` | `Validators.required` |
| MRD.1 — clinician accountability | `doctorName` + backend `createdBy = req.user.username` | `Validators.required` client + controller-side stamp |
| MRD.1 — timestamp | `date` | Backend stamps `date = new Date()` on insert |
| Auditability (every write) | — | **Gap**: not yet wired through HmisAuditLog. Backend `addProgressNote` has no audit-log call or HMIS push. Flagged in `GAP_ANALYSIS.md` Module 6; scheduled for Sprint 4 when outbound push functions land. Frontend has no responsibility for this. |

## Known divergences

1. **HMIS push** — not wired on the backend. `addProgressNote` doesn't call `pushIpdProgressNote` (no such client method yet) or `createHmisAuditLog`. Not in Sprint 3a-2 scope.
2. **Pagination UI** — backend supports `?page=&limit=`, frontend doesn't yet send them. Acceptable for v1 (max 10 per admission in practice); revisit when we see admissions with 10+ notes.
3. **Nurse-authored vs. doctor-authored** — schema has `createdBy` but no explicit "author role" field. Backend stamps `req.user.username`; frontend relies on `doctorName` as the visible author. If nurses need a separate audit trail, that's a schema change (Sprint 4+).

## Frontend-only assumptions flagged

- Environment file path hardcoded to `environment.prod.ts` in [ipd.service.ts:4](../../../Frontend/Hospital-Admin-Panel/src/app/services/ipd.service.ts). Pre-existing pattern across all HMIS services; not changed in this sprint. Sprint 3+ cleanup candidate: centralise environment import.
- `ActivatedRoute` param name `admissionId` must match route definition. Verified in both `app-routing.module.ts` and component.
