# Sprint 2a — IPD Admission (Backend HMIS push wiring)

Source rows: `docs/GAP_ANALYSIS.md` Module 5 and Module 9.
Scope: wire a real HMIS push through the Sprint-1 wrapper for `POST /api/ipd/admission`. Close the silent-stub gap. No frontend. No Figma.

---

## Step 1 — Plan

### What the gap analysis says
- `IpdAdmission` schema: present, matches plan (with `sourceModule/referralOpdId/referralEmergencyId` instead of plan's boolean pair — previously accepted as keep-current-design).
- `POST /api/ipd/admission` (`createIpdAdmission` handler in [src/api/ipd/ipd.controller.ts](../../src/api/ipd/ipd.controller.ts)): **route registered, handler exists, but no real HMIS push**. The handler writes a `createHmisAuditLog({ status: 'success', ... })` row without ever calling HMIS — a silent stub.

### What I will CREATE
- A tiny adapter inside `createIpdAdmission` that wires the existing `pushIpdAdmission` function (in [hmis-client.ts](../../src/api/hmis-sync/hmis-client.ts)) through the Sprint-1 `syncWithHmis` wrapper. The wrapper already handles success/failure audit logs.
- Jest integration tests for the controller covering:
  - happy path (HMIS 2xx → admission created, bed occupied, hmisAdmissionId stored, audit log `status=success`)
  - HMIS failure path (HMIS rejects → admission still created, bed still occupied, audit log `status=failed`, response to client still 201)
- A small helper function (`__buildIpdHmisPayload`) exposed from the controller file for test assertion, so we don't re-compose the payload shape in the test.

### What I will PATCH
- Remove the existing silent audit log block (lines 106–116) in `createIpdAdmission`.
- Replace with a single `syncWithHmis(...)` call.
- After a successful push whose result contains an `id`, persist it onto `admission.hmisAdmissionId` via a follow-up `prisma.ipdAdmission.update` and return the updated value in the response.

### What I will REFACTOR
- Nothing else in Sprint 2a scope. `updateIpdAdmission` / `transferPatient` / `addProgressNote` still miss pushes and audit logs but are Sprint 2b/c and a later sprint. Not touching them here.

### What I will LEAVE ALONE
- Schema. No additive column needed — `hmisAdmissionId String?` already exists on `IpdAdmission`.
- `pushIpdAdmission` in hmis-client.ts — its retry + auth logic is fine; it stays as the operation passed to `syncWithHmis`.
- Frontend screens. Sprint 2 is backend-only per user instruction.
- The 6 remaining `(prisma as any)` casts in `hmis-sync.controller.ts` — those live in webhook handlers (bed-status-update etc.) and will be cleaned when Sprint 2c touches the bed-transfer webhook path. Not in 2a's blast radius.

### HMIS push contract
- `direction`: `push`
- `module`: `ipd`
- `entityType`: `admission`
- `action`: `admission_created`
- `payload`: the full `admission` row returned by Prisma (already excludes sensitive fields; includes bed + ward via `include`)
- `operation`: `() => pushIpdAdmission({ admissionNo, prn, admissionType, sourceModule, doctorName: admittingDoctor, department, diagnosis })`
- `swallowErrors`: not set (defaults to `true`) — HMIS failure must NOT break the admission flow (bed is already occupied at this point; we cannot roll back without leaving the bed in a broken state)
- Retry: default (`maxRetries: 0`) — the hmis-client internally retries 3× with exponential backoff already

### Response semantics
- On HMIS success with an `id` field → admission response includes `hmisAdmissionId` populated.
- On HMIS success without an `id` → admission response returns without `hmisAdmissionId`; audit log is still `status=success`.
- On HMIS failure → admission response returns 201 with `hmisAdmissionId=null`; audit log is `status=failed` with full error detail. The retry cron (hourly, per Sprint 1-3) will attempt to resync via `getFailedSyncs`.

### Test plan (2 tests minimum, per briefing)
1. **Happy path**: stub `pushIpdAdmission` to resolve with `{ id: 'HMIS-ADM-7' }`. Assert:
   - Response status 201, body includes the admission
   - `prisma.ipdAdmission.update` called once with `{ hmisAdmissionId: 'HMIS-ADM-7' }`
   - Audit helper called once with `status: 'success'`, `module: 'ipd'`, `action: 'admission_created'`
2. **Failure path**: stub `pushIpdAdmission` to reject with an axios-shape `{ response: { status: 503, data: { err: 'HMIS down' } } }`. Assert:
   - Response status still 201 (admission succeeds)
   - Bed was still marked occupied
   - `prisma.ipdAdmission.update` NOT called a second time (no hmisAdmissionId to store)
   - Audit helper called once with `status: 'failed'`, error detail includes `status: 503`

### Hard-rule checks
- [ ] No new `any` / `@ts-ignore`
- [ ] Wrapper is used (no raw `pushIpdAdmission` call outside wrapper)
- [ ] Audit log written on success AND failure (via wrapper)
- [ ] No schema change, no migration
- [ ] No frontend change
- [ ] One test per new push point (we have 2)
