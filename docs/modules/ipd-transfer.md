# Sprint 2c — IPD Transfer (Backend HMIS push wiring + transactional bed flips + hmis-sync.controller cast cleanup)

Source rows: `docs/GAP_ANALYSIS.md` Module 5.b and Module 12.
Scope: three things bundled because they all live in the same blast radius:
1. Wire real HMIS push through the Sprint-1 wrapper for `POST /api/ipd/admission/:admissionId/transfer`.
2. Make source/destination bed flips atomic with the admission update via `prisma.$transaction`.
3. Clean up the 6 remaining `(prisma as any)` casts in `hmis-sync.controller.ts` per the user's Sprint 2b follow-up note. Two of them mask a real UUID-vs-Int bug.

No frontend. No Figma. Inline-await per Sprint 2 latency policy.

---

## Step 1 — Plan

### What the gap analysis says
- `transferPatient` handler (ipd.controller.ts line ~629) exists, does the 3 DB writes, but:
  - No real HMIS push — only a silent-stub `createHmisAuditLog({ status: 'success' })` with no network call.
  - No transaction: if the 2nd or 3rd `prisma.ipdBed.update` throws, the admission is already updated → orphaned state.
  - No guard against transferring an already-discharged admission.
  - No guard against transferring to the same bed (no-op edge case).
- No `hmisTransferId` field anywhere in the schema.
- No `pushIpdTransfer` function in `hmis-client.ts`.
- `hmis-sync.controller.ts` has 6 `(prisma as any)` casts. Two of them — lines 294 and 343 — call `parseInt(bedId)` / `parseInt(admissionId)`. Both IDs are `String` UUIDs in the schema. `parseInt` on a UUID returns `NaN`, so these webhook handlers have been silently broken whenever HMIS actually sends a bed-status-update or discharge-confirmed webhook. The cast hides this from the compiler.

### What I will CREATE
- **Schema**: one additive column `hmisTransferId String?` on `IpdAdmission`. Purpose: on successful transfer push, persist the HMIS-returned transfer ID so later reconciliation can join local transfers to HMIS records. Note: this overwrites on repeat transfer of the same admission — a full `IpdTransfer` history model is out of Sprint 2c scope and would be a separate sprint if the clinical team wants audit-grade transfer history.
- **Migration**: `add_hmistransferid_to_ipd_admission` (additive, nullable — no data loss risk, no backfill).
- **`pushIpdTransfer` function in hmis-client.ts**: dedicated `POST /adt/transfer` call with admissionId, prn, from/to bed and ward, reason, timestamp.
- **`buildIpdTransferHmisPayload` helper in ipd.controller.ts**: typed payload builder, exported for test assertions.
- **Test suite** `src/api/ipd/__tests__/ipd-transfer.test.ts`: happy + HMIS failure + 2 sanity tests + 1 transaction-atomicity test (5 total).

### What I will PATCH
- `transferPatient` handler:
  - Wrap admission update + old bed flip + new bed flip in `prisma.$transaction([...])` so they commit-or-rollback together. HMIS push stays OUTSIDE the transaction (per Sprint 2 policy: local state first, HMIS audit-logged separately).
  - Add new guards (returned as 409 where semantically appropriate):
    - `admission.status !== 'admitted'` → 409 "Admission is not in a transferable state"
    - `newBedId === admission.bedId` → 409 "Target bed is the same as current bed"
  - Preserve existing guards (400 missing fields, 404 admission not found, 409 new bed occupied).
  - Replace silent-stub `createHmisAuditLog` with `syncWithHmis(...)` wrapping `pushIpdTransfer` (inline-await).
  - On HMIS success with `id` in response → persist as `hmisTransferId` via `prisma.ipdAdmission.update`.
- **`hmis-sync.controller.ts` cast cleanup** (6 casts → 0):
  - Line 24: `appointment.update` — IDs are Int in schema, `parseInt(appointmentRef)` is correct. Just remove cast.
  - Line 89, 170: `investigationResult.upsert` — IDs are Int, cast removal is safe.
  - Line 240: `prescription.update where: { prescriptionId }` — `prescriptionId` is the `String @unique` field, cast removal safe.
  - **Line 294**: `ipdBed.update where: { id: parseInt(bedId) }` — **BUG**: `IpdBed.id` is `String` UUID. Fixing: drop `parseInt`, use `bedId` directly as string.
  - **Line 343**: `ipdAdmission.update where: { id: parseInt(admissionId) }` — **same bug**. Same fix.

### What I will REFACTOR
- Nothing outside the transfer handler + the 6-cast cleanup. `updateIpdAdmission` (line 293 silent audit) and `addProgressNote` remain Sprint-2-scope untouched — they are separate gaps not part of 2c.

### What I will LEAVE ALONE
- Existing behavior: transfer returns 200 (not 201) and includes the updated admission in the response — preserving.
- `medications` storage format in `IpdDischarge`.
- Follow-up auto-creation in `createDischarge`.
- Other webhook handlers in hmis-sync.controller.ts beyond the 6 cast sites.

### HMIS push contract
- `direction`: `push`
- `module`: `ipd` (transfer is admission-lifecycle, not its own module like discharge — plan NABH ACC.4 lives under IPD)
- `entityType`: `transfer`
- `action`: `bed_transfer`
- `payload`: transfer context (admissionId, prn, fromBedId, toBedId, fromWardId, toWardId, reason)
- `operation`: `() => pushIpdTransfer({ admissionId, prn, fromBedId, toBedId, fromWardId, toWardId, reason, timestamp })`
- `swallowErrors`: default `true` (local transaction already committed; we do NOT roll back bed state on HMIS failure)
- Retry: wrapper default `maxRetries: 0`. hmis-client internal retry still active.

### Atomicity design (transaction semantics)
```typescript
const [updated] = await prisma.$transaction([
  prisma.ipdAdmission.update({ where: { id: admissionId }, data: { bedId: newBedId, wardId: newWardId, ... } }),
  prisma.ipdBed.update({ where: { id: admission.bedId }, data: { status: 'available' } }),
  prisma.ipdBed.update({ where: { id: newBedId }, data: { status: 'occupied' } }),
]);
```
If any of the three fails, all three roll back. Prevents orphaned state where admission points at new bed but beds are in wrong status. HMIS push runs AFTER the transaction commits; if HMIS fails, local state is still correct and the failure audit log enables retry.

### Response semantics
- Happy path: 200 with updated admission, `hmisTransferId` populated.
- HMIS failure: 200 with updated admission, `hmisTransferId = null`, failure audit log written.
- 400/404/409 responses pre-transaction: no HMIS call, no DB writes.

### Test plan (5 tests)
1. **Happy path**: stub `pushIpdTransfer` → `{ id: 'HMIS-TX-9' }`. Assert transaction runs (3 ops), HMIS push called with full payload, `hmisTransferId` persisted, success audit.
2. **HMIS failure**: stub `pushIpdTransfer` rejects 503. Assert transaction still commits, no `hmisTransferId` update, failure audit log with status 503 + detail.
3. **Sanity — 400**: missing `newBedId` → 400, no DB writes, no HMIS.
4. **Sanity — 409 already-discharged admission**: admission.status='discharged' → 409, no DB writes, no HMIS.
5. **Sanity — 409 same-bed transfer**: newBedId === admission.bedId → 409, no DB writes, no HMIS.

### Hard-rule checks
- [ ] No new `any` / `@ts-ignore`
- [ ] Wrapper used (no raw `pushIpdTransfer` outside wrapper)
- [ ] Audit on success AND failure
- [ ] Migration is additive (column only, nullable, no backfill)
- [ ] Tests: ≥2 (I have 5)
- [ ] Atomic bed flips via `prisma.$transaction`
- [ ] Inline-await per Sprint 2 latency policy
- [ ] 6 `(prisma as any)` casts removed from hmis-sync.controller.ts
- [ ] The 2 UUID-vs-Int bugs fixed in hmis-sync.controller.ts
