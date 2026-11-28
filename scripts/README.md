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

## `backfill-patient-phones.ts`

Fills `PatientDetails.mobileNo` for patients with **no** phone number
(`mobileNo` and `contactNo` both empty) from their most recent
**staff-handled** appointment with the same PRN (checked in, or booked by a
logged-in user). WhatsApp-bot and AI-receptionist bookings are never used —
the patient number receives the record-access OTP — and `Online` (website)
bookings count only if the patient was checked in. A number shared by more
than `--max-shared` different patients (default 10) is skipped as a likely
desk/agent number. Only valid Indian mobiles (10 digits, starting 6–9) are
written, and an existing number is never overwritten. Same rules as the automatic check-in backfill
(`backfillPatientPhone` in `src/api/patient/patient-helper.ts`).

### Run

```bash
cd Hospital-Admin-Panel-Backend
npx ts-node scripts/backfill-patient-phones.ts           # dry run: counts + masked examples, writes nothing
npx ts-node scripts/backfill-patient-phones.ts --apply   # writes
# optional: --max-shared=N to change the shared-number limit (default 10)
```

`--apply` saves a change log (`patientId,prn,mobileNoSet`) as
`~/phone-backfill-<db>-<timestamp>.csv` (mode 600). It contains phone
numbers — keep it private and out of the repo; it is the record for undoing.
Re-running is safe: patients already filled are no longer candidates.

## `server/docminds-db-backup.sh`

Hourly MySQL backup for the production server, kept on the server only
(`~/db-backups`). Keeps every backup from today, 3 per past day (09:00,
15:00, 23:00) for 30 days, and deletes older ones. A failed dump never
deletes previous backups.

Credentials are read from `~/.docminds-backup.cnf` (chmod 600) — **never
commit that file or put a password in the script.**

### Install (on the server)

```bash
git pull
mkdir -p ~/bin
cp scripts/server/docminds-db-backup.sh ~/bin/
chmod 700 ~/bin/docminds-db-backup.sh
time nice -n 19 ionice -c3 ~/bin/docminds-db-backup.sh   # first run by hand
crontab -e   # add:  5 * * * * nice -n 19 ionice -c3 /home/doc-minds/bin/docminds-db-backup.sh
```

Cron runs the copy in `~/bin`, so a `git pull` does not change the live job
until you copy it again. Check: `cat ~/db-backups/backup.log`,
`grep FAILED ~/db-backups/backup.log`.
