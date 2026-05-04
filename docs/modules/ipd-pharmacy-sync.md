# Sprint 2d — IPD Pharmacy Ops · Sync Check

Backend-only. Verifies that the 4 IPD pharmacy write endpoints push through the Sprint-1 wrapper on a **fire-and-forget** timeline (no await before responding) and that `HmisAuditLog` rows are still written on both outcomes.

Derived from the tests in [src/api/ipd/__tests__/ipd-pharmacy.test.ts](../../src/api/ipd/__tests__/ipd-pharmacy.test.ts).

## MAR audit row (highest-volume pharmacy event — administer)

### Success row
Captured `createHmisAuditLog` arguments when `pushIpdMedicationAdmin` resolves with `{ id: "HMIS-MAR-1" }`:

```json
{
  "direction": "push",
  "module": "ipd-mar",
  "action": "medication_administered",
  "payload": "<JSON of IpdMedicationLog row: id, prescriptionId, admissionId, administeredAt, administeredBy, quantity, route, remarks>",
  "response": "{\"entityType\":\"medication-admin\",\"result\":{\"id\":\"HMIS-MAR-1\"}}",
  "status": "success",
  "retryCount": 0
}
```

### Failure row
Captured when `pushIpdMedicationAdmin` rejects with axios-shape 500:

```json
{
  "direction": "push",
  "module": "ipd-mar",
  "action": "medication_administered",
  "payload": "<JSON of IpdMedicationLog row>",
  "response": "{\"entityType\":\"medication-admin\",\"error\":{\"message\":\"mar-push-failed\",\"status\":500,\"detail\":{\"err\":\"pharmacy module down\"}}}",
  "status": "failed",
  "retryCount": 0
}
```

Key properties:
- `marLogId` is always in the HMIS push payload (not in `HmisAuditLog.response` directly — it's in the `payload` field since the wrapper stringifies the whole IpdMedicationLog row). This gives HMIS a stable reference to the local MAR event.
- `retryCount: 0` in both — wrapper default `maxRetries: 0`. Hourly cron retries failed rows.

## Fire-and-forget timeline — confirmed per endpoint

| Handler | Response sent → | Then fire-and-forget → | Audit row written |
|---|---|---|---|
| `continuePrescription` | 201 with `{data: ipdPrescription}` | `pushIpdPrescription(buildIpdPrescriptionPayload(rx, 'continued'))` | success OR failed |
| `modifyPrescription` | 200 with `{data: updatedRx}` | `pushIpdPrescription(buildIpdPrescriptionPayload(rx, 'modified'))` | success OR failed |
| `discontinuePrescription` | 200 with `{data: prescription}` | `pushIpdPrescriptionDiscontinue(...)` | success OR failed |
| `administerMedication` | 200 with `{data: {prescription, marLog}}` | `pushIpdMedicationAdmin(buildIpdMedicationAdminPayload(...))` | success OR failed |

In every test, assertions on `pushIpd*` and `createHmisAuditLog` run AFTER `flushMicrotasks()` so the fire-and-forget chain completes. Before that flush, `res.status(...)` has already been called — confirming the response leaves the handler before the HMIS push resolves/rejects.

## Response body constraint — confirmed

Per the user's explicit rule "no HMIS IDs in response body under fire-and-forget":
- `data.hmisRxId` is `null` in every happy-path test response body
- `data.marLog.id` is the local `IpdMedicationLog.id` (UUID), never HMIS's returned id
- The HMIS id (`HMIS-RX-*`, `HMIS-MAR-*`) lives only in `HmisAuditLog.response`

## Guards — confirmed

| Handler | Guard tested | Result |
|---|---|---|
| `continuePrescription` | Missing required fields (genericName/dose/etc.) → 400 | ✅ no HMIS, no audit |
| `modifyPrescription` | Prescription update throws → 500 | ✅ no HMIS, no audit |
| `discontinuePrescription` | Prescription update throws → 500 | ✅ no HMIS, no audit |
| `administerMedication` | Prescription not found → 404 | ✅ no HMIS, no audit, no MAR log |

## Read-endpoint contracts — confirmed

| Handler | Contract asserted |
|---|---|
| `reviewCarryoverPrescriptions` | Filters by `admission.prn` + `prescribedDate >= sevenDaysAgo` ISO window |
| `getPendingMedications` | `where: { admissionId, status: 'active', adminStatus: 'pending' }` ordered by `nextAdminTime asc` |
| `getMedicationAdministrationRecord` | `where: { admissionId }` + `orderBy: { administeredAt: 'desc' }` + pagination (page, limit, total, pages) |

All three read endpoints verified to NEVER call `syncWithHmis` or `createHmisAuditLog`.

## Cleanup note

No schema change. No migration. No real-DB-touching Prisma CLI command this sprint.

---

## Sprint 3c Contract Expansion (2026-04-19)

While building the Sprint 3c frontend, two of this module's GET endpoints
were found to return shapes too thin to render the clinical UI. The backend
was minimally patched (controller-only, no schema change) so the endpoints
actually deliver what their names imply. Documented here to preserve the
audit trail.

### Change 1 — `reviewCarryoverPrescriptions` now returns tablet detail

**Before** ([ipd-prescription.controller.ts:147-152](../../src/api/ipd/ipd-prescription.controller.ts)):

```ts
const carryoverOptions = pendingPrescriptions.map((prescription) => ({
  prescriptionId: prescription.prescriptionId,
  prescribedBy: prescription.prescribedBy,
  prescribedDate: prescription.prescribedDate,
}));
```

Only 3 fields. `genericName / brandName / frequency / route / quantity / instructions` all lived on the child `Tablet[]` relation but were never included or returned.

**After**:

```ts
const pendingPrescriptions = await prisma.prescription.findMany({
  where: { prn: admission.prn, prescribedDate: { gte: sevenDaysAgo } },
  include: { tablets: true },                                // ← added
});

const carryoverOptions = pendingPrescriptions.map((prescription) => ({
  prescriptionId: prescription.prescriptionId,
  prescribedBy: prescription.prescribedBy,
  prescribedDate: prescription.prescribedDate,
  patientName: prescription.patientName,                     // ← added
  tablets: prescription.tablets,                             // ← added (1:N)
}));
```

**New response shape** (per row):

```ts
{
  prescriptionId: string;
  prescribedBy: string;
  prescribedDate: string;
  patientName: string;
  tablets: Array<{
    id: number;
    genericName: string;
    brandName: string;
    frequency: string;
    duration: string;
    route: string | null;     // default 'oral'
    quantity: number;
    instructions: string;
  }>;
}
```

Frontend flattens to one row per tablet.

### Change 2 — `getMedicationAdministrationRecord` now carries drug identity

**Before** ([ipd-prescription.controller.ts:575-580](../../src/api/ipd/ipd-prescription.controller.ts)): returned raw `IpdMedicationLog` rows which carry only `prescriptionId` (FK string) — **no `genericName`, no drug identity at all**. The nurse's MAR view could not render drug name without an N+1 follow-up per row.

**Relation verification**: `IpdMedicationLog` has a raw `prescriptionId String` FK column but **no named Prisma relation field** to `IpdPrescription` (confirmed in [schema.prisma:1579-1593](../../prisma/schema.prisma)). Prisma `include: { prescription: true }` therefore would not compile. **Took branch (c) of the Sprint 3c backend brief: batch-fetch distinct `prescriptionId`s and stitch in JS.**

**After**:

```ts
const marLogs = await prisma.ipdMedicationLog.findMany({ where: { admissionId }, orderBy, skip, take });
const total   = await prisma.ipdMedicationLog.count({ where: { admissionId } });

const distinctPrescriptionIds = Array.from(new Set(marLogs.map((l) => l.prescriptionId)));
const prescriptions = distinctPrescriptionIds.length > 0
  ? await prisma.ipdPrescription.findMany({
      where: { id: { in: distinctPrescriptionIds } },
      select: { id: true, genericName: true, brandName: true, frequency: true, route: true },
    })
  : [];
const rxById = new Map(prescriptions.map((rx) => [rx.id, rx]));
const enrichedLogs = marLogs.map((l) => ({ ...l, prescription: rxById.get(l.prescriptionId) ?? null }));
```

**New response shape** (per row):

```ts
{
  id: string;
  prescriptionId: string;
  admissionId: string;
  administeredAt: DateTime;
  administeredBy: string;
  quantity: number;
  route: string;
  remarks: string | null;
  createdAt: DateTime;
  prescription: {
    id: string;
    genericName: string;
    brandName: string | null;
    frequency: string;
    route: string;
  } | null;                     // null if the parent prescription was deleted
}
```

**Cost**: one extra Prisma query per page (paginated, `skip/take` unchanged). `SELECT` projection limits the fetched columns. Memory is `O(distinct prescription ids on the page)`, capped by the page size (default 10).

### Why not branch (b) `include: { prescription: true }`

Prisma `include` requires a named relation field on the model. `IpdMedicationLog.prescriptionId` is a plain `String` column without a `prescription IpdPrescription @relation(fields: [prescriptionId], references: [id])` companion, so the type system rejects `include`. Adding that relation field would be a schema change — out of scope for a frontend-sprint controller-only patch.

## Regression tests added — 2 new, 2 updated

All four tests live in [src/api/ipd/__tests__/ipd-pharmacy.test.ts](../../src/api/ipd/__tests__/ipd-pharmacy.test.ts) alongside the existing contract tests.

| Test | Asserts |
|---|---|
| `reviewCarryoverPrescriptions — contract > "returns prescriptions filtered …"` (**updated**) | Asserts `include: { tablets: true }` is passed to `prisma.prescription.findMany` and the response shape now includes `patientName` + `tablets`. |
| `reviewCarryoverPrescriptions — contract > "includes each prescription's tablets[]"` (**new**) | Mocks 1 prescription with 2 tablets and asserts both tablets surface with `genericName / brandName / frequency / route / quantity / instructions`. |
| `getMedicationAdministrationRecord — contract > "returns MAR logs with pagination …"` (**updated**) | Mocks the new `ipdPrescription.findMany` path. Contract (pagination, `orderBy` desc, skip/take) unchanged. |
| `getMedicationAdministrationRecord — contract > "enriches each log with drug identity …"` (**new**) | Mocks 3 logs spanning 2 distinct prescriptions. Asserts the batch-fetch `findMany` is called **once** with the deduped id set, and each log row carries the correct enriched `prescription.genericName / .route`. |

**Full backend suite after the 3c expansion**: 8 suites / **79 tests pass** (77 pre-3c + 2 new regressions). Zero regressions.

---

# Sprint 3c — Frontend sync check

Every form field / action in the Pharmacy + MAR screens maps to exactly one backend endpoint. Patient context is always resolved through PatientDetails (the canonical patient table per the audit).

## Screen A — Pharmacy Review

### Field → backend mapping

| UI surface | Column / form field | Backend response field | Notes |
|---|---|---|---|
| Carryover row | Drug name | `tablets[].genericName` (fallback `brandName`) | From 3c-expanded response |
| Carryover row | Frequency | `tablets[].frequency` | |
| Carryover row | Route | `tablets[].route` (nullable → `'oral'`) | |
| Carryover row | Qty · Instructions | `tablets[].quantity` + `tablets[].instructions` | Combined cell |
| Carryover row | Source | `prescribedBy` + "OPD" literal | |
| Active row | Drug name | `genericName` (fallback `brandName`) | |
| Active row | Dose | `dose` | IPD-side column exists (unlike OPD) |
| Active row | Frequency | `frequency` | |
| Active row | Route | `route` | |
| Active row | Started | `prescribedDate` (formatted) | |
| Active row | Status pill | `status` → `active` / `paused` / `discontinued` | §2 badge convention extrapolation — flagged in parity |
| Modify modal | dose / frequency / duration / route / instructions | PUT body | No `reason` field sent; backend accepts partial updates |

### UI action → backend endpoint

| Action | HTTP | Endpoint | Body |
|---|---|---|---|
| **Continue carryover row** | `POST` | `/api/ipd-pharmacy/admission/:id/continue` | full `IpdPrescription` shape (admissionId, prescriptionId, prescribedBy, genericName, brandName?, dose, frequency, duration, route, instructions?, quantity, isCarryOver: true, carryOverFrom: 'opd', adminStatus: 'pending', status: 'active') |
| **Modify active row** | `PUT` | `/api/ipd-pharmacy/prescription/:rxId/modify` | `{ dose, frequency, duration, route, instructions? }` |
| **Discontinue active row** | `PUT` | `/api/ipd-pharmacy/prescription/:rxId/discontinue` | `{ reason? }` |

### Fire-and-forget contract

- Frontend shows success toast immediately after the `201 / 200` response.
- **No `hmisRxId` is displayed** anywhere in the UI. Backend doesn't include HMIS ids in the fire-and-forget response body (see Sprint 2d contract above); frontend simply doesn't attempt to surface them.
- No "syncing to HMIS" spinner. HMIS reconciliation is invisible.

### Error handling

- Modify / Administer modals stay open on any 4xx/5xx so user can retry without re-entering.
- Continue path: error toast, carryover row is **not** removed from the list (user can retry the same button).
- Discontinue: error toast, dialog closes; user can retry from the row.

## Screen B — Medication Administration Record (MAR)

### Field → backend mapping

| UI surface | Column / form field | Backend response field | Notes |
|---|---|---|---|
| Pending row | Drug name | `genericName` (fallback `brandName`) | |
| Pending row | Next due | `nextAdminTime` (formatted) | nullable → `—` |
| Pending row | Route | `route` | |
| Pending row | Frequency | `frequency` | |
| Pending row | Qty | `quantity` | |
| Administered row | Drug name | `prescription.genericName` | **Via 3c-expanded response** — batch-fetched from `IpdPrescription` and stitched server-side |
| Administered row | Given at | `administeredAt` (formatted) | |
| Administered row | By | `administeredBy` | backend-stamped from `req.user.username` |
| Administered row | Qty | `quantity` | |
| Administered row | Route | `route` | |
| Administered row | Remarks | `remarks` (nullable) | |
| Administer modal | quantity / route / remarks | POST body | UI field names `quantity / route / remarks`; service-layer maps to the admin-log shape (`dose` carries quantity string per existing service signature) |

### UI action → backend endpoint

| Action | HTTP | Endpoint | Body |
|---|---|---|---|
| **Administer pending row** | `POST` | `/api/ipd-pharmacy/prescription/:rxId/administer` | `MedicationAdminLog` shape (`prescriptionId, adminTime, administeredBy: '' (server-stamped), dose, route, notes?`) |

### Fire-and-forget contract

Same as Screen A. The returned `marLog.id` is a local UUID, not the HMIS id. No sync-status UI.

## Patient context path — both screens

1. Read `admissionId` from `ActivatedRoute.snapshot.paramMap`.
2. `IpdService.getAdmission(admissionId)` → returns admission with `.prn`.
3. `AppointmentConfirmService.getDetailsByPRN(String(prn))` → returns `PatientDetails`.
4. `<app-page-header>` renders the combined context.

**Confirms the going-forward rule**: patient resolution goes through `PatientDetails` via the PRN; no read from `Appointment.patientId` (null in practice anyway per the audit) and no direct read from `Patient`.

## Empty-state coverage

| Empty state | Copy | Trigger |
|---|---|---|
| Pharmacy §1 | "No carryover prescriptions to review" | backend returns empty `data` array |
| Pharmacy §2 | "No active IPD prescriptions" | all prescriptions filtered out (none with `status !== 'discontinued'`) |
| MAR §1 | "No medications pending administration" | backend returns empty array |
| MAR §2 | "No administrations recorded today" | backend returns empty array |

All four use `<app-empty-state>` (P4).

## Known divergences (flagged for future sprints)

1. **Status pill colors** for `paused` / `discontinued` are extrapolated (see parity doc §1).
2. **Carryover "Modify / Discontinue" actions** mentioned in the original Sprint 3c brief are **not implemented** — they'd operate on an OPD prescription but the backend only has endpoints for IPD `prescriptionId`. Carryover rows expose **Continue only**; modification/discontinuation happen after Continue creates the IPD row. Scope decision preserved in parity doc §2.
3. **Modify modal has no "reason for change" field** — backend doesn't persist a modification reason. Flagged for designer + Sprint 4 schema review.
