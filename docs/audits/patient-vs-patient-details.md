# Patient vs PatientDetails — Audit

Audit date: 2026-04-19 (between Sprint 3b and Sprint 3c, at user request).
Purpose: information-gathering only. No code or schema is modified.

---

## Verdict

> **`PatientDetails` is the canonical patient table used by the application.**
> `Patient` is **almost entirely unused** — one defensive read remains, with a null-safe fallback, so in practice no business logic relies on rows in the `Patient` table.

Precise classification (per the brief's options):

> **"Patient is PARTIALLY USED — described below."** Specifically: schema-level only + one defensive `include` on Appointment that works correctly even when the relation resolves to `null`. Zero write sites anywhere in `src/`. Zero production call sites that treat a `Patient` row as authoritative data.

**Going-forward guidance (§5 below)**: all Sprint 3c+ code must read from and write to `PatientDetails` exclusively.

---

## 1. Schema inventory ([prisma/schema.prisma](../../prisma/schema.prisma))

### 1.1 `Patient` — lines 228-239 (minimal model)

```prisma
model Patient {
  id           Int           @id @default(autoincrement())
  prn          Int           @unique
  name         String
  phoneNumber  String
  email        String
  created_at   DateTime      @default(now())
  updated_at   DateTime      @updatedAt
  age          Int?
  gender       Int?
  appointments Appointment[] @relation("AppointmentToPatient")
}
```

9 columns + 1 reverse relation. No `hmisUhid`, no vitals, no address fields.

### 1.2 `PatientDetails` — lines 241-278 (comprehensive model)

```prisma
model PatientDetails {
  id              Int       @id @default(autoincrement())
  prn             Int       @unique
  name            String
  foreignNational Boolean?
  contactNo       String?
  mobileNo        String?
  email           String?
  age             String?
  gender          String?
  address         String?
  country         String?
  state           String?
  district        String?
  city            String?
  area            String?
  pin             String?
  created_at      DateTime  @default(now())
  updated_at      DateTime?
  BPd             String?   BPs String?   RR String?
  bloodGroup      String?
  diagnosis       String?
  dob             String?
  hb              String?
  height          String?
  patientType     String?
  pulse           String?   rh String?   sFerritin String?   spo2 String?   temp String?   weight String?
  hmisUhid        String?

  @@index([hmisUhid])
}
```

35 columns including vitals, demographics, HMIS UHID, patient type. **No relation fields.** Not referenced as a FK target by any other model.

### 1.3 Foreign keys pointing to each table

| Pointer | Target table | Schema line | Relation |
|---|---|---|---|
| `Appointment.patientId Int?` | `Patient.id` | 192 | `patient Patient? @relation("AppointmentToPatient")` |
| — | `PatientDetails` | — | **No FKs anywhere in the schema point to `PatientDetails`.** |

So Patient has exactly 1 incoming FK. PatientDetails has zero.

### 1.4 Implication

Rows in `Patient` would only matter if something reads them via `Appointment.patient`. PatientDetails is reached via its unique `prn` column (used as a soft key everywhere).

---

## 2. Backend code inventory — `src/`

### 2.1 `prisma.patient.*` call sites (the Patient table)

Grep (ripgrep): `prisma\.patient[^A-Za-z]` over `src/`:

> **Zero matches.**

Verified with a second grep `prisma\.patient\b` (word boundary). Every `prisma.patient...` hit in the first grep was followed by `Details` (i.e., `prisma.patientDetails`).

**Backend writes:** zero. Nobody calls `prisma.patient.create`, `.update`, `.delete`, `.upsert`, or `.createMany`.
**Backend reads (direct):** zero. Nobody calls `prisma.patient.findFirst/findMany/findUnique/count`.

### 2.2 `prisma.patientDetails.*` call sites

Ripgrep `prisma\.patientDetails\.` over `src/` — **18 occurrences across 5 files**:

| File | Call sites | Purpose |
|---|---|---|
| [api/patient/patient.repository.ts](../../src/api/patient/patient.repository.ts):11, 15, 19, 23, 26, 29 | 6 | Patient repository CRUD — create / findFirst (by id) / update / delete / findFirst-by-mobile / findMany |
| [api/patient/patient.controller.ts](../../src/api/patient/patient.controller.ts):127, 176, 184, 201, 211 | 5 | Public HTTP handlers (`POST /`, `GET /:id`, `PUT /:prn`, `POST /get-details-by-prn`, `PUT /:id`) |
| [api/patient/patient-helper.ts](../../src/api/patient/patient-helper.ts):12, 83, 98, 135 | 4 | `generatePRN` (reads last prn), `createOrGetPatient` (find-or-create), `syncExistingPatientsToHmis` batch |
| [api/hmis-sync/critical-value-sse.ts](../../src/api/hmis-sync/critical-value-sse.ts):240 | 1 | Resolve patient name for SSE alert payload |
| [api/ipd/follow-up-automation.ts](../../src/api/ipd/follow-up-automation.ts):103 | 1 | Resolve patient mobile + email for follow-up appointment auto-creation |
| [api/ipd/discharge-pdf-generator.ts](../../src/api/ipd/discharge-pdf-generator.ts):92 | 1 | Resolve patient demographics for discharge summary PDF |

Every module that needs to know "who is this patient" reads `PatientDetails`.

### 2.3 Indirect use of `Patient` — one defensive site

Grep `include:\s*\{[^}]*patient:\s*true` over `src/` returns **one** hit:

[api/conversion/opd-to-ipd.ts:19-25](../../src/api/conversion/opd-to-ipd.ts):

```ts
const appointment = await prisma.appointment.findUnique({
  where: { id: appointmentId },
  include: {
    doctor: true,
    patient: true,    // ← the Patient relation
  },
});
```

This is then used at lines 35, 45, 73:

```ts
prn: appointment.patient?.prn?.toString() || '',     // null-safe
```

All three uses apply `?.prn?.toString() || ''` so a null `patient` resolves to empty string without throwing. **No business logic relies on Patient rows existing**; the fallback is the real path in practice.

### 2.4 `Appointment.patientId` FK — usage

Grep `patientId` over `src/`:

> **One hit**: [api/ipd/follow-up-automation.ts:138](../../src/api/ipd/follow-up-automation.ts) — writes `patientId: patient.id` when creating a follow-up Appointment. But here `patient` is a `PatientDetails` row (line 103), and `patient.id` is the PatientDetails row id, **not** a Patient.id. Prisma accepts any Int into `patientId` (it's `Int?` on Appointment, with loose FK that MySQL enforces referential integrity on only if Patient.id matches). This is almost certainly a **latent inconsistency**: the FK is declared to point at Patient.id, but the writer is passing PatientDetails.id.

> That's a pre-existing bug outside this audit's scope. Flagged.

### 2.5 HMIS sync paths

- [hmis-client.ts:50-72](../../src/api/hmis-sync/hmis-client.ts) — `pushPatient(patientData)` sends `prn/name/dateOfBirth/gender/phoneNumber/email/address/bloodGroup` to HMIS. It's a pure HTTP push; it doesn't read any Prisma table.
- [patient-helper.ts:50-57](../../src/api/patient/patient-helper.ts) — `syncPatientToHmis(patientData)` maps the supplied object (`mobileNo || contactNo` → `phoneNumber`) then calls `pushPatient`. **The supplied object comes from `prisma.patientDetails.create()` in `createOrGetPatient`** (line 98 → 121), so the HMIS push originates from a PatientDetails row.
- [patient-helper.ts:133-162](../../src/api/patient/patient-helper.ts) — `syncExistingPatientsToHmis(limit)` iterates `prisma.patientDetails.findMany()` and pushes each to HMIS.

> **HMIS side reads PatientDetails only.** Patient table is not involved in any HMIS push or pull.

---

## 3. Seed script — [scripts/seed-sprint-3.ts](../../scripts/seed-sprint-3.ts)

Grep `prisma\.patient[A-Z]?` in `scripts/` — **6 matches, all in `seed-sprint-3.ts`**:

- Lines 62, 66: `prisma.patient.count` / `findFirst` inside the `findNonSeedRows()` safety-check — reads both tables for safety.
- Lines 73, 77: `prisma.patientDetails.count` / `findFirst` same purpose.
- Line 252: `prisma.patient.upsert` — creates Patient rows in seed data.
- Line 266: `prisma.patientDetails.upsert` — creates matching PatientDetails rows.

The seed script currently writes to **both** tables. Given the audit finding, the Patient-row writes in the seed are wasted: nobody reads them. Flagged in §5 (Going-forward guidance) below.

---

## 4. Frontend code inventory — `Frontend/Hospital-Admin-Panel/src/`

### 4.1 Services

[services/appointment-confirm.service.ts](../../../../Frontend/Hospital-Admin-Panel/src/app/services/appointment-confirm.service.ts:412-425) hits `/api/patients*` endpoints:

```ts
addPatient()                → POST /patients
getPatient(patientId)       → GET  /patients/:patientId
getDetailsByPRN(prnNumber)  → POST /patients/get-details-by-prn
updatePatient(prn, data)    → PUT  /patients/:prn
getAllPatients()            → GET  /patients
```

All five endpoints resolve to handlers in [patient.controller.ts](../../src/api/patient/patient.controller.ts) which **every** time calls `prisma.patientDetails.*`. So the frontend's "patient" API talks to PatientDetails. The URL path `/api/patients` is a misleading legacy name — the backing table is `PatientDetails`.

### 4.2 Components that consume the shape

- [patient/patient-details/patient-details.component.ts](../../../../Frontend/Hospital-Admin-Panel/src/app/patient/patient-details/patient-details.component.ts) — list view (misnamed; it lists all patients). Calls `patientService.getAllPatients()`.
- [patient/patient-overview/patient-overview.component.ts](../../../../Frontend/Hospital-Admin-Panel/src/app/patient/patient-overview/patient-overview.component.ts) — container for the patient area.
- [patient/patient-info/patient-info.component.html](../../../../Frontend/Hospital-Admin-Panel/src/app/patient/patient-info/patient-info.component.html) — detail view.
- [patient/patient-new/patient-new.component.ts](../../../../Frontend/Hospital-Admin-Panel/src/app/patient/patient-new/patient-new.component.ts) — registration form.
- [appointment/new-form/new-form.component.ts:488, 1895](../../../../Frontend/Hospital-Admin-Panel/src/app/appointment/new-form/new-form.component.ts) — `loadPatientDetails(patientId)`, builds a `patientDetails` object from form inputs.
- [appointment/appointment-form/appointment-form.component.ts:654, 2289](../../../../Frontend/Hospital-Admin-Panel/src/app/appointment/appointment-form/appointment-form.component.ts) — same pattern.
- Multiple other modules (MHC, service-radiology, emergency) read patient data via the same API surface.

**Every frontend consumer uses fields from the PatientDetails schema** (e.g., `mobileNo`, `contactNo`, `bloodGroup`, `dob`, `hmisUhid`). None of them read fields unique to `Patient` (since Patient has no unique fields — it's a subset of PatientDetails minus extras).

---

## 5. Database — actual row counts (read-only, run via a throwaway `scripts/audit-patient-counts.ts` then deleted)

Query result against the dev DB:

```
Patient.count ............................ 3
PatientDetails.count ..................... 3
Appointment.count ........................ 2
Appointment.count (patientId != null) ... 0

Sample Patient row: { id: 1, prn: 9900001, name: 'SEED — Ravi Kumar' }
Sample PatientDetails row: { id: 1, prn: 9900001, name: 'SEED — Ravi Kumar', hmisUhid: null }

Overlap (Patient.prn ∈ PatientDetails.prn) . 3
```

Observations:

- Both tables hold 3 rows each. All three are SEED rows I wrote in Sprint 3b — the dev DB was empty of both tables before seeding.
- **`Appointment.patientId IS NOT NULL` count = 0.** Every appointment — including the two seeded ones — has `patientId = null`. Which means the `Appointment.patient` relation always resolves to `null`, which means the defensive `include` in `opd-to-ipd.ts` always hits the `|| ''` fallback.
- Every PRN in Patient also exists in PatientDetails (3/3 overlap). The tables mirror each other on PRN but diverge on column count.

---

## 6. HMIS sync — explicit confirmation

Reviewed:

- [hmis-sync/hmis-client.ts](../../src/api/hmis-sync/hmis-client.ts) — pure HTTP client. Reads nothing from Prisma.
- [hmis-sync/critical-value-sse.ts:240](../../src/api/hmis-sync/critical-value-sse.ts) — `prisma.patientDetails.findFirst`. PatientDetails.
- [patient/patient-helper.ts](../../src/api/patient/patient-helper.ts) — every HMIS push source is a PatientDetails row.

> **No HMIS code path reads or writes the `Patient` table.**

---

## Summary tables

### Where `Patient` is referenced

| Location | File | Line(s) | Kind | Effectively active? |
|---|---|---|---|---|
| Schema | prisma/schema.prisma | 228-239 | model definition | N/A |
| Schema | prisma/schema.prisma | 192 | `Appointment.patientId` FK | active — column exists, always null in practice |
| Schema | prisma/schema.prisma | 238 | `Appointment[]` reverse relation on Patient | active — compiled into Prisma client, unused at runtime |
| Backend code | src/api/conversion/opd-to-ipd.ts | 21-23 | `include: { patient: true }` | active but null-safe; always resolves to null in current DB state |
| Backend code | src/api/ipd/follow-up-automation.ts | 138 | writes `patientId: patient.id` with a PatientDetails row id | **latent bug** — wrong table's id written into the Patient-referencing FK |
| Seed | scripts/seed-sprint-3.ts | 252 | `prisma.patient.upsert` | active — seed data |
| DB | — | — | 3 SEED rows | active |

### Where `PatientDetails` is referenced

| Location | File | Line(s) | Kind |
|---|---|---|---|
| Schema | prisma/schema.prisma | 241-278 | model definition |
| Backend | src/api/patient/patient.repository.ts | 11, 15, 19, 23, 26, 29 | CRUD |
| Backend | src/api/patient/patient.controller.ts | 127, 176, 184, 201, 211 | HTTP handlers |
| Backend | src/api/patient/patient-helper.ts | 12, 83, 98, 135 | PRN gen, create-or-get, HMIS batch |
| Backend | src/api/hmis-sync/critical-value-sse.ts | 240 | SSE alert enrichment |
| Backend | src/api/ipd/follow-up-automation.ts | 103 | discharge follow-up appointment builder |
| Backend | src/api/ipd/discharge-pdf-generator.ts | 92 | discharge PDF builder |
| Backend | src/api/hmis-sync/* (via patient-helper) | — | every HMIS push of patient data |
| Frontend | services/appointment-confirm.service.ts | 412-425 | `/patients` API consumers |
| Frontend | patient/patient-details, patient-overview, patient-info, patient-new | — | UI |
| Frontend | appointment/new-form, appointment-form, MHC, service-radiology, emergency | — | indirect consumers |
| Seed | scripts/seed-sprint-3.ts | 266 | upsert |
| DB | — | — | 3 SEED rows |

---

## Going-forward guidance

1. **All Sprint 3c+ backend code reads and writes `PatientDetails`**, not `Patient`. Continue the pattern already established by every current module except the one null-safe `include` call.
2. **All Sprint 3c+ frontend code consumes the `/api/patients*` endpoints** (which back onto PatientDetails). Don't bypass to a hypothetical "/api/patient" (no such thing).
3. **`Appointment.patientId`** — don't rely on it. The FK exists in the schema but is never populated correctly in practice; look up patient data by `Appointment.prnNumber` + `prisma.patientDetails.findUnique({ where: { prn } })` instead.
4. **Seed script** — [scripts/seed-sprint-3.ts](../../scripts/seed-sprint-3.ts) currently writes to both tables. Recommend (Sprint 3c-Sprint 3d timeframe) trimming the Patient writes to just PatientDetails, since nothing reads the Patient rows. **Will wait for user approval before editing the seed script** — not destroying the Patient table; just stop re-seeding it.
5. **Latent bug acknowledgement** — `follow-up-automation.ts:138` writes `PatientDetails.id` into `Appointment.patientId` (which is declared as a FK to `Patient.id`). In the current empty-Patient-table state this is harmless; if Patient ever gets rows, this would violate referential integrity. Out of scope for Sprint 3 but worth a Sprint 4 cleanup item. **Not fixing here.**
6. **`Patient` stays untouched.** No migration, no drop, no removal plan. The model definition remains in `schema.prisma`. The three seeded rows remain in the DB.
