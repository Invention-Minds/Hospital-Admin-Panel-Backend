# Manual Testing Toolkit

This doc gathers every dev-only tool for manual UI testing of the Docminds
backend without real HMIS credentials: a local HMIS mock server, sample
webhook curls, expected `HmisAuditLog` states, seed-data references, and
audit-trail SQL.

---

## 1. HMIS mock server — let outbound pushes succeed in dev

When real HMIS credentials aren't yet available (Sprint 4-era reality), the
backend's outbound `axios` calls to the HMIS base URL fail with `ENOTFOUND`
because the default `http://hmis-server/api` is not a real host. This:

- Adds 5–7 seconds of latency to every action that inline-awaits a push
  (createMlcCase, recordExamination, createDischarge, etc.).
- Writes `HmisAuditLog` rows with `status='failed'` for every push.
- Leaves the `hmisXxxId` columns (`MlcCase.hmisMlcId`, `IpdDischarge.hmisDischargeId`, etc.) as NULL on every record.

The mock server eliminates all three: pushes succeed instantly, audit logs
go to `success`, mock `hmisXxxId` values get backfilled.

### Start it

```bash
# Terminal 1
cd Hospital-Admin-Panel-Backend
npm run mock:hmis
```

Expected boot output:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  HMIS mock server up on http://localhost:9999
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Health probe:

```bash
curl http://localhost:9999/health
# → {"status":"ok","uptime":1.234,"totalRequests":0}
```

### Point Docminds at it

Add to `Hospital-Admin-Panel-Backend/.env` (or update if present):

```env
HMIS_BASE_URL=http://localhost:9999/api
HMIS_API_KEY=test-key
```

Then restart the backend:

```bash
# Terminal 2
npm run start:dev
```

### What to expect with the mock running

| Symptom | Without mock | With mock |
|---|---|---|
| UI action latency (inline-await pushes) | 5–7s extra per action | sub-100ms |
| `HmisAuditLog.status` for outbound pushes | `failed` | **`success`** |
| `HmisAuditLog.response` | error JSON: `{"error":{"code":"ENOTFOUND",...}}` | result JSON: `{"result":{"id":"MOCK-MLC-...","success":true,...}}` |
| `hmisMlcId` / `hmisLamaId` / `hmisDamaId` / `hmisDischargeId` on records | NULL | `MOCK-<MODULE>-<hash>` |

### Mock server endpoint coverage (mirrors `hmis-client.ts`)

Every push path Docminds emits is handled. Mock IDs are deterministic
(SHA-1 hash of method + path + body, first 8 chars) so re-running the same
action produces the same mock id.

| Method | Path | Source function |
|---|---|---|
| POST | `/api/patients` | `pushPatient` |
| POST | `/api/emergency/register` | `pushEmergencyToHmis` |
| POST | `/api/opd/assessment` | `pushOpdAssessment` |
| POST | `/api/investigation/order` | `pushInvestigationOrder` |
| POST | `/api/pharmacy/prescription` | `pushPrescription` |
| POST | `/api/adt/admission` | `pushIpdAdmission` |
| POST | `/api/adt/transfer` | `pushIpdTransfer` |
| POST | `/api/adt/discharge` | `pushIPDDischarge` |
| POST | `/api/pharmacy/ipd-prescription` | `pushIpdPrescription` |
| POST | `/api/pharmacy/ipd-prescription/discontinue` | `pushIpdPrescriptionDiscontinue` |
| POST | `/api/pharmacy/medication-administered` | `pushIpdMedicationAdmin` |
| POST | `/api/mlc/register` | `pushMlcCase` |
| PUT | `/api/mlc/:hmisMlcId` | `pushMlcUpdate` (lifecycle) |
| POST | `/api/lama/register` | `pushLamaCase` |
| PUT | `/api/lama/:hmisLamaId` | `pushLamaUpdate` |
| POST | `/api/dama/register` | `pushDamaCase` |
| PUT | `/api/dama/:hmisDamaId` | `pushDamaUpdate` |
| GET | `/api/laboratory/results` | `pollLabResults` (returns `{results:[],total:0}`) |
| GET | `/api/radiology/results` | `pollRadiologyResults` (same) |
| GET | `/api/beds/availability` | `pollBedAvailability` (same) |
| GET | `/api/master/:type` | `getMasterData` |
| any | `/api/*` (catch-all) | unknown future paths fall through to the same `{id,success}` shape |

### Verifying with one curl

```bash
curl -s -X POST http://localhost:9999/api/mlc/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-key" \
  -d '{"mlcNo":"MLC-TEST-001","caseType":"accident","status":"documented"}'
# → {"id":"MOCK-MLC-71012094","success":true,"receivedAt":"...","echoedPath":"/api/mlc/register"}
```

The `id` value is what the controller persists as `MlcCase.hmisMlcId`.

### Mock isolation

`scripts/hmis-mock-server.ts` is **not** in the production build path:
- `tsconfig.json`'s `include` is `["index.ts", "src/**/*.ts", "global.d.ts"]` — `scripts/**` is excluded.
- No file under `src/` imports anything from `scripts/`.
- Tests use jest mocks for `hmis-client`; they do not touch this server.

Do not move it to `src/`. The mock is a dev-only entry point.

---

## 2. Inbound webhook testing (curl)

The 6 webhook endpoints are mounted at `/api/hmis-sync/webhooks/*` with
**no authentication** by design (HMIS posts here from outside; HMAC
signing is on the 4b backlog).

> All examples assume Docminds backend on `http://localhost:5000` and
> seed-sprint-3 + seed-dev-auth data is loaded.

### 2a — Lab result ready (the most-testable end-to-end flow)

Triggers the SSE critical-values fan-out when `criticalFlag=true`.

```bash
# Critical-flag path (will fire SSE alert if a frontend listener is connected)
curl -X POST http://localhost:5000/api/hmis-sync/webhooks/lab-result-ready \
  -H "Content-Type: application/json" \
  -d '{
    "prn": "9900003",
    "orderId": 1,
    "testName": "Potassium",
    "result": "7.2",
    "unit": "mmol/L",
    "referenceRange": "3.5-5.0",
    "criticalFlag": true,
    "reportUrl": "https://example.com/report.pdf"
  }'

# Normal-flag (no critical alert; just records the result)
curl -X POST http://localhost:5000/api/hmis-sync/webhooks/lab-result-ready \
  -H "Content-Type: application/json" \
  -d '{
    "prn": "9900003",
    "orderId": 1,
    "testName": "Sodium",
    "result": "140",
    "unit": "mmol/L",
    "referenceRange": "135-145",
    "criticalFlag": false
  }'
```

To watch the SSE alert in another terminal:

```bash
curl -N http://localhost:5000/api/critical-values/stream?userId=alice
```

### 2b — Payment confirmed (auto-checks-in patient)

```bash
# Use an existing pending appointment id (e.g., 5 from seed-dev-auth)
curl -X POST http://localhost:5000/api/hmis-sync/webhooks/payment-confirmed \
  -H "Content-Type: application/json" \
  -d '{
    "uhid": "U-1001",
    "appointmentRef": "5",
    "receiptNo": "R-001",
    "amountPaid": 500,
    "timestamp": "2026-04-21T12:00:00Z"
  }'
```

### 2c — Radiology result ready

```bash
curl -X POST http://localhost:5000/api/hmis-sync/webhooks/radiology-result-ready \
  -H "Content-Type: application/json" \
  -d '{
    "prn": "9900003",
    "orderId": 2,
    "testName": "Chest X-Ray PA",
    "result": "Right lower lobe consolidation; otherwise unremarkable.",
    "criticalFlag": false,
    "reportUrl": "https://example.com/cxr.pdf"
  }'
```

### 2d — Pharmacy dispensed

```bash
curl -X POST http://localhost:5000/api/hmis-sync/webhooks/pharmacy-dispensed \
  -H "Content-Type: application/json" \
  -d '{
    "prn": "9900003",
    "prescriptionId": "rx-mock",
    "dispensedAt": "2026-04-21T12:00:00Z",
    "dispensedBy": "Pharmacist-X"
  }'
```

### 2e — Bed status update

```bash
curl -X POST http://localhost:5000/api/hmis-sync/webhooks/bed-status-update \
  -H "Content-Type: application/json" \
  -d '{
    "bedId": "<copy from SEED-G-02 etc.>",
    "status": "available"
  }'
```

### 2f — Discharge confirmed

```bash
curl -X POST http://localhost:5000/api/hmis-sync/webhooks/discharge-confirmed \
  -H "Content-Type: application/json" \
  -d '{
    "admissionId": "<copy from SEED-IPD-001 admission row>",
    "hmisDischargeId": "MOCK-EXTERNAL-DIS-001",
    "confirmedAt": "2026-04-21T12:00:00Z"
  }'
```

---

## 3. Expected `HmisAuditLog` states per action

Every clinical action emits at least one audit row. The exact `module` and
`action` values are stable; the `status` depends on whether the mock is
running.

### Outbound push (Docminds → HMIS)

| UI action | Module | Action | With mock | Without mock |
|---|---|---|---|---|
| Save OPD assessment | `opd` | `opd_assessment_pushed` (or similar) | `success` | `failed` |
| Register MLC | `mlc` | `mlc_registered` | `success` | `failed` |
| MLC examination / samples / report | `mlc` | `mlc_examination` / `mlc_samples_collected` / `mlc_report_submitted` | `success` | `failed` |
| Create LAMA / DAMA | `lama` / `dama` | `lama_created` / `dama_created` | `success` | `failed` |
| Update LAMA / DAMA | `lama` / `dama` | `lama_updated` / `dama_updated` | `success` | `failed` |
| Create IPD admission | `ipd` | `ipd_admitted` | `success` | `failed` |
| IPD progress note saved | `ipd` | `ipd_progress_note` | `success` | `failed` |
| IPD prescription new/modify/discontinue | `ipd-pharmacy` | `ipd_prescription_created` / `_modified` / `_discontinued` | `success` | `failed` |
| Medication administered | `ipd-mar` | `medication_administered` | `success` | `failed` |
| Discharge created | `discharge` | `discharge_created` | `success` | `failed` |
| Patient transfer | `ipd` | `transfer_completed` | `success` | `failed` |
| Bed-census snapshot (cron 00:05) | `bed-census` | `snapshot_generated` | (no HMIS push — internal only) | `success` |

### Inbound webhook (HMIS → Docminds)

| Webhook | Module | Action | Status |
|---|---|---|---|
| `lab-result-ready` | `investigation` | `lab_result_received` | `success` (or `failed` if PRN missing) |
| `radiology-result-ready` | `investigation` | `radiology_result_received` | `success` |
| `payment-confirmed` | `appointment` | `payment_confirmed` | `success` |
| `pharmacy-dispensed` | `pharmacy` | `dispensed_received` | `success` |
| `bed-status-update` | `bed-status` | `bed_updated` | `success` |
| `discharge-confirmed` | `discharge` | `discharge_confirmed` | `success` |

### Internal-audit-only (no HMIS roundtrip)

| Source | Module | Action |
|---|---|---|
| Follow-up auto-creation (Sprint 4a Phase 1c) | `follow-up` | `appointment_auto_created` / `_skipped` / `_failed` |
| Bed-census cron (Sprint 4a Phase 1e) | `bed-census` | `snapshot_generated` / `snapshot_dup_blocked` / `snapshot_failed` |

---

## 4. Audit-trail SQL queries

### Latest audit rows across the whole system

```sql
SELECT id, direction, module, action, status, retryCount, createdAt
FROM HmisAuditLog
ORDER BY createdAt DESC
LIMIT 30;
```

### All failed pushes (to confirm whether the mock is helping)

```sql
SELECT module, action, COUNT(*) AS failures, MAX(createdAt) AS lastSeen
FROM HmisAuditLog
WHERE status = 'failed' AND direction = 'push'
GROUP BY module, action
ORDER BY failures DESC;
```

### Audit row detail for a specific action

```sql
SELECT id, action, status, payload, response, createdAt
FROM HmisAuditLog
WHERE module = 'mlc' AND createdAt > NOW() - INTERVAL 1 HOUR
ORDER BY createdAt DESC;
```

### Verify hmis-id backfill with the mock running

```sql
-- After registering a new MLC case with the mock running:
SELECT id, mlcNo, status, hmisMlcId, createdAt
FROM MlcCase
ORDER BY id DESC LIMIT 5;
-- hmisMlcId should be 'MOCK-MLC-<8-char-hash>' for new rows; NULL for pre-mock rows.

-- Same for LAMA, DAMA, discharge:
SELECT id, hmisLamaId FROM LamaRecord ORDER BY id DESC LIMIT 5;
SELECT id, hmisDamaId FROM DamaRecord ORDER BY id DESC LIMIT 5;
SELECT id, hmisDischargeId FROM IpdDischarge ORDER BY id DESC LIMIT 5;
```

### Failure-only view (Sprint 4b.4 retry-cron material)

```sql
SELECT id, module, action, retryCount, createdAt,
       JSON_EXTRACT(response, '$.error.message') AS errorMessage
FROM HmisAuditLog
WHERE status = 'failed' AND retryCount < 3
ORDER BY createdAt DESC;
```

---

## 5. Seed-data references

Defined and documented in [scripts/README.md](../scripts/README.md). Two
seed scripts cover the dev DB:

- **`scripts/seed-sprint-3.ts`** — clinical data: 2 wards, 6 beds, 3
  patients (PRNs 9900001–3), 1 active IPD admission (SEED-IPD-001),
  2 progress notes, 2 prescriptions, 1 critical lab result.
- **`scripts/seed-dev-auth.ts`** — auth + scheduling: 6 users (admin /
  nurse / 4 doctors), 4 departments, 4 doctors, 3 more patients
  (PRN 9900004–6), 3 today-dated appointments, 2 extra beds (HDU + isolation).

Login credentials (from seed-dev-auth):

| Role | employeeId / phone | password |
|---|---|---|
| Admin | `admin` | `admin123` |
| Nurse | `nurse.geetha` | `nurse123` |
| Doctor (Cardiology) | `dr.priya` or phone `919876501001` | `doctor123` |
| Doctor (General Med) | `dr.mahesh` / `919876501002` | `doctor123` |
| Doctor (Emergency) | `dr.raghav` / `919876501003` | `doctor123` |
| Doctor (OBG/Surgery) | `dr.kavitha` / `919876501004` | `doctor123` |

---

## 6. Known caveats

- **Mock IDs are not persistent across mock restarts** in any way that
  matters — the same input always hashes to the same id, but the mock
  doesn't track state. If a controller re-pushes the same record, the
  mock returns the same id, which is what the backfill logic expects.
- **No HMAC verification** on inbound webhooks — they accept any payload.
  Real-HMIS hardening happens in a separate Sprint 4b backlog item.
- **Retry cron is stubbed** (`hmis-sync.queue.ts:~374`); failed pushes
  accumulate without auto-replay until Sprint 4b.4.
- **Lab/radiology/bed pull crons** will hit the mock every 30 minutes if
  it's running. The mock returns empty arrays so nothing is ingested —
  this is fine.
