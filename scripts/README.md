# Backend scripts

Utility scripts. All scripts run via `npx ts-node` from the backend root
(i.e. `Hospital-Admin-Panel-Backend/`). They use the same Prisma client +
`.env` `DATABASE_URL` as the application.

## `seed-sprint-3.ts`

Creates a small, tagged dataset for manual testing of Sprint 3a–3g modules
(IPD Progress Notes, Discharge, Pharmacy/MAR, MLC, LAMA/DAMA, Admit-to-IPD,
Critical-values).

### Run

```bash
cd Hospital-Admin-Panel-Backend
npx ts-node scripts/seed-sprint-3.ts
```

### What it writes

| Entity | Count | Tag |
|---|---|---|
| `IpdWard` | 2 | `wardCode` starts with `SEED-` |
| `IpdBed` | 6 | `bedNumber` starts with `SEED-` |
| `PatientDetails` | 3 | `prn` ∈ `9900001…9999999`; `name` starts with `SEED — `; canonical patient table (see `docs/audits/patient-vs-patient-details.md`) |
| `Appointment` | 2 | `patientName` starts with `SEED — ` and `prnNumber` in seed range |
| `Emergency` | 1 | `prn = SEED-ER-001` |
| `IpdAdmission` | 1 | `admissionNo = SEED-IPD-001` |
| `IpdProgressNote` | 2 | linked to the seeded admission |
| `IpdPrescription` | 2 | linked to the seeded admission (one IV, one oral PRN) |
| `InvestigationOrder` | 1 | `remarks = 'SEED — routine panel'` |
| `InvestigationResult` | 1 | `testName = 'SEED — Potassium'`, `criticalFlag = true` |

### Safety guarantees

- **Non-destructive**: no `DELETE`, `TRUNCATE`, `DROP`, or `deleteMany`
  anywhere in the script. Verify with `grep -E "delete|truncate|drop" scripts/seed-sprint-3.ts`.
- **Safe**: before writing, the script counts rows in every table it
  touches that do *not* match the seed pattern. If any non-seed rows are
  found, the script aborts with exit code 2 and prints a sample row from
  each offending table so you can investigate.
- **Idempotent**: every insert goes through `upsert` (for models with a
  unique business key) or `findFirst` + `create` (for models without
  one). Running the script twice on a fresh DB yields the same row
  count; the second run reports `skipped` instead of `created`.

### Undoing

To remove seed data, run one-off SQL in your DB client. All markers are
documented above; e.g.:

```sql
DELETE FROM IpdProgressNote       WHERE createdBy = 'seed-script';
DELETE FROM IpdPrescription       WHERE createdBy = 'seed-script';
DELETE FROM IpdAdmission          WHERE admissionNo = 'SEED-IPD-001';
DELETE FROM IpdBed                WHERE bedNumber LIKE 'SEED-%';
DELETE FROM IpdWard               WHERE wardCode  LIKE 'SEED-%';
DELETE FROM Emergency             WHERE prn = 'SEED-ER-001';
DELETE FROM InvestigationResult   WHERE testName LIKE 'SEED —%';
DELETE FROM InvestigationOrder    WHERE remarks  = 'SEED — routine panel';
DELETE FROM appointments          WHERE patientName LIKE 'SEED —%';
DELETE FROM PatientDetails        WHERE prn BETWEEN 9900001 AND 9999999;
-- Patient table is no longer populated by this seed script, but the
-- rows from the pre-trim run (2026-04-19) can be cleared if desired:
-- DELETE FROM Patient            WHERE prn BETWEEN 9900001 AND 9999999;
```

(Exact table names may differ per Prisma's `@@map` — adjust if needed.)

### Navigate after seeding

The script prints exact URLs at the end. Typical next steps:

- `/ipd` — see the seeded IPD admission in the list.
- `/ipd/admission/<seeded-admission-id>/progress-note` — Sprint 3a-2 screen.
- `/ipd/admission/<seeded-admission-id>/discharge` — Sprint 3b screen (once built).
