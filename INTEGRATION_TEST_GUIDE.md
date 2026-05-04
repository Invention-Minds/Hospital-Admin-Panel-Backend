# Docminds HMIS Integration - Testing Guide

This guide provides step-by-step instructions to test the complete OPD → IPD → Discharge workflow integration.

## Prerequisites

1. Server running on `http://localhost:3000` (or your configured PORT)
2. MySQL database at `34.86.173.79:3306` with `admin_panel` database
3. All Prisma migrations completed (154 migrations)
4. Environment variables configured in `.env`

---

## Phase 1: Ward & Bed Setup

### 1.1 Create a Ward

```bash
curl -X POST http://localhost:3000/api/ward/ward \
  -H "Content-Type: application/json" \
  -d '{
    "wardName": "General Ward - A",
    "wardCode": "GW-A",
    "floor": "1",
    "department": "General Medicine",
    "totalBeds": 10
  }'
```

**Expected Response:**
```json
{
  "message": "Ward created successfully",
  "data": {
    "id": "uuid-string",
    "wardName": "General Ward - A",
    "wardCode": "GW-A",
    ...
  }
}
```

### 1.2 Create Beds for the Ward

```bash
curl -X POST http://localhost:3000/api/ward/ward/{wardId}/beds \
  -H "Content-Type: application/json" \
  -d '{
    "beds": [
      { "bedNumber": "A-001", "bedType": "general" },
      { "bedNumber": "A-002", "bedType": "general" },
      { "bedNumber": "A-003", "bedType": "ICU" }
    ]
  }'
```

### 1.3 Get Available Beds

```bash
curl -X GET "http://localhost:3000/api/ward/beds/available" \
  -H "Content-Type: application/json"
```

---

## Phase 2: Patient Registration & OPD Workflow

### 2.1 Create Patient (Auto-generates PRN)

```bash
curl -X POST http://localhost:3000/api/patients \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "9876543210",
    "dob": "1990-01-15",
    "gender": "male",
    "bloodGroup": "O+",
    "address": "123 Main Street"
  }'
```

**Expected Response:**
```json
{
  "prn": "JMRH-2026-001",
  "name": "John Doe",
  ...
}
```

**Note:** PRN is auto-generated and immediately synced to HMIS (async, doesn't block response)

### 2.2 Create OPD Appointment

```bash
curl -X POST http://localhost:3000/api/appointments \
  -H "Content-Type: application/json" \
  -d '{
    "patientPrn": "JMRH-2026-001",
    "doctorId": 1,
    "departmentId": 1,
    "appointmentDate": "2026-04-20",
    "timeSlot": "10:00-10:30",
    "remarks": "General checkup"
  }'
```

### 2.3 Create OPD Assessment

```bash
curl -X POST http://localhost:3000/api/opd \
  -H "Content-Type: application/json" \
  -d '{
    "patientName": "John Doe",
    "uhid": "JMRH-2026-001",
    "age": "36",
    "gender": "male",
    "date": "2026-04-20",
    "consultant": "Dr. Smith",
    "department": "General Medicine",
    "assessmentTime": "10:15",
    "height": "180",
    "weight": "75",
    "hr": "72",
    "rr": "16",
    "pulse": "72",
    "bp": "120/80",
    "temp": "37",
    "spo2": "98",
    "history": "Patient reports general fatigue",
    "examination": "Normal physical examination",
    "investigation": "Recommended blood tests",
    "treatmentPlan": "Continue with medication",
    "doctorSign": "url-to-signature",
    "doctorName": "Dr. Smith",
    "kmcNo": "KMC123456",
    "appointmentId": 1
  }'
```

### 2.4 Create Investigation Order (Auto-syncs to HMIS)

```bash
curl -X POST http://localhost:3000/api/investigation \
  -H "Content-Type: application/json" \
  -d '{
    "prn": "JMRH-2026-001",
    "doctorId": 1,
    "doctorName": "Dr. Smith",
    "remarks": "Complete blood work and chest X-ray",
    "labTests": [1, 2, 3],
    "radiologyTests": [1],
    "packages": [],
    "date": "2026-04-20"
  }'
```

**Expected:** Investigation order created and automatically synced to HMIS (audit logged)

### 2.5 Create Prescription (Auto-syncs to HMIS)

```bash
curl -X POST http://localhost:3000/api/prescription \
  -H "Content-Type: application/json" \
  -d '{
    "prescribedBy": "Dr. Smith",
    "prn": "JMRH-2026-001",
    "patientName": "John Doe",
    "prescribedDate": "2026-04-20",
    "prescribedById": 1,
    "prescribedByKMC": "KMC123456",
    "tablets": [
      {
        "genericName": "Paracetamol",
        "brandName": "Crocin",
        "frequency": "1-1-1",
        "duration": "5 days",
        "instructions": "After meals",
        "quantity": 15
      }
    ]
  }'
```

**Expected:** Prescription created (prescriptionId: JMRH-RX-001) and synced to HMIS pharmacy module

---

## Phase 3: OPD → IPD Conversion

### 3.1 Admit OPD Patient to IPD

```bash
curl -X POST http://localhost:3000/api/opd/admit-to-ipd \
  -H "Content-Type: application/json" \
  -d '{
    "appointmentId": 1,
    "wardId": "uuid-of-ward",
    "bedId": "uuid-of-available-bed",
    "admittingDoctorId": 1,
    "admittingDoctorName": "Dr. Smith",
    "admissionType": "routine"
  }'
```

**Expected Response:**
```json
{
  "message": "Patient admitted to IPD from OPD",
  "data": {
    "ipdAdmission": {
      "id": "uuid",
      "admissionNo": "JMRH-IPD-0001",
      "prn": "JMRH-2026-001",
      "sourceModule": "opd",
      "referralOpdId": "1",
      "status": "admitted",
      ...
    },
    "pendingPrescriptions": [
      {
        "prescriptionId": "JMRH-RX-001",
        "genericName": "Paracetamol",
        ...
      }
    ],
    "pendingInvestigations": [
      {
        "id": 1,
        "prn": "JMRH-2026-001",
        ...
      }
    ]
  }
}
```

### 3.2 Review Carryover Prescriptions for IPD

```bash
curl -X GET http://localhost:3000/api/ipd-pharmacy/admission/{admissionId}/review-carryover \
  -H "Content-Type: application/json"
```

**Expected:** List of pending prescriptions from OPD for review

### 3.3 Continue OPD Prescription in IPD

```bash
curl -X POST http://localhost:3000/api/ipd-pharmacy/admission/{admissionId}/continue \
  -H "Content-Type: application/json" \
  -d '{
    "prescriptionId": "JMRH-RX-001",
    "genericName": "Paracetamol",
    "brandName": "Crocin",
    "dose": "500mg",
    "frequency": "1-1-1",
    "duration": "5 days",
    "route": "oral",
    "instructions": "After meals",
    "quantity": 15,
    "prescribedBy": "Dr. Smith"
  }'
```

**Expected:** IPD prescription created with `isCarryOver: true`, `carryOverFrom: 'opd'`

---

## Phase 4: IPD Stay & Progress Notes

### 4.1 Add Progress Note (SOAP)

```bash
curl -X POST http://localhost:3000/api/ipd/admission/{admissionId}/progress-note \
  -H "Content-Type: application/json" \
  -d '{
    "doctorName": "Dr. Smith",
    "subjective": "Patient reports improved symptoms",
    "objective": "Vitals stable, blood pressure normal",
    "assessment": "Responding well to treatment",
    "plan": "Continue current medications, monitor vitals",
    "nursingNotes": "Patient comfortable, tolerating oral intake",
    "vitalsBP": "120/80",
    "vitalsHR": "70",
    "vitalsTemp": "37",
    "vitalsSpO2": "98",
    "vitalsRR": "16"
  }'
```

### 4.2 Get Progress Notes

```bash
curl -X GET "http://localhost:3000/api/ipd/admission/{admissionId}/progress-notes?page=1&limit=10" \
  -H "Content-Type: application/json"
```

### 4.3 Administer Medication (MAR - Medication Administration Record)

```bash
curl -X POST http://localhost:3000/api/ipd-pharmacy/prescription/{prescriptionId}/administer \
  -H "Content-Type: application/json" \
  -d '{
    "quantity": 1,
    "route": "oral",
    "remarks": "Patient took medication with water"
  }'
```

**Expected:**
- Prescription `adminStatus` updated to "administered"
- Entry created in `IpdMedicationLog`
- Logged to HMIS audit trail

### 4.4 Get Medication Administration Record (MAR)

```bash
curl -X GET "http://localhost:3000/api/ipd-pharmacy/admission/{admissionId}/mar?page=1&limit=10" \
  -H "Content-Type: application/json"
```

---

## Phase 5: IPD Discharge

### 5.1 Create Discharge Summary

```bash
curl -X POST http://localhost:3000/api/ipd/admission/{admissionId}/discharge \
  -H "Content-Type: application/json" \
  -d '{
    "dischargeType": "regular",
    "finalDiagnosis": "Viral fever, resolved",
    "proceduresDone": "Blood tests, Chest X-ray",
    "conditionAtDischarge": "Good",
    "dischargeSummary": "Patient admitted with fever, treated with antibiotics and supportive care. Vitals stable at discharge. Follow up with PCP in 1 week.",
    "followUpDate": "2026-04-27",
    "followUpDoctor": "Dr. Smith",
    "medications": [
      {
        "genericName": "Paracetamol",
        "brandName": "Crocin",
        "dose": "500mg",
        "frequency": "1-0-1",
        "duration": "3 days"
      }
    ],
    "advice": "Rest, light diet, avoid heavy work. Take medications as prescribed."
  }'
```

**Expected:**
- `IpdDischarge` record created
- `IpdAdmission.status` updated to "discharged"
- Bed status changed back to "available"
- HMIS audit logged

### 5.2 Get Discharge Summary

```bash
curl -X GET http://localhost:3000/api/ipd/admission/{admissionId}/discharge \
  -H "Content-Type: application/json"
```

---

## Phase 6: Ward & Bed Census Reporting

### 6.1 Get All Wards with Bed Census

```bash
curl -X GET http://localhost:3000/api/ward/wards \
  -H "Content-Type: application/json"
```

**Expected:**
```json
{
  "message": "Wards retrieved with bed census",
  "data": [
    {
      "id": "uuid",
      "wardName": "General Ward - A",
      "wardCode": "GW-A",
      "occupiedBeds": 1,
      "availableBeds": 9,
      "censusPercentage": 10,
      "beds": [...]
    }
  ]
}
```

### 6.2 Get Bed Census Report

```bash
curl -X GET http://localhost:3000/api/ward/census-report \
  -H "Content-Type: application/json"
```

**Expected:** Summary report with occupancy rates for all wards

### 6.3 Transfer Patient to Different Bed

```bash
curl -X POST http://localhost:3000/api/ipd/admission/{admissionId}/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "newBedId": "uuid-of-another-bed",
    "newWardId": "uuid-of-another-ward",
    "reason": "Isolation required due to infection risk"
  }'
```

**Expected:**
- Old bed status → "available"
- New bed status → "occupied"
- Admission updated with new bed/ward
- Transfer logged to audit trail

---

## Emergency to IPD Workflow

### E1. Create Emergency Case (Auto-generates PRN)

```bash
curl -X POST http://localhost:3000/api/emergency \
  -H "Content-Type: application/json" \
  -d '{
    "patientName": "Jane Doe",
    "phoneNumber": "9876543211",
    "age": "28",
    "gender": "female",
    "triageCategory": "red",
    "presentingComplaint": "Severe chest pain",
    "abcdeAssessment": "Airway patent, breathing labored, circulation compromised",
    "traumaScore": 25,
    "vitalsBP": "90/60",
    "vitalsHR": "120",
    "vitalsRR": "28",
    "vitalsSpO2": "92",
    "vitalsTemp": "38.5",
    "proceduresDone": "IV access established"
  }'
```

**Expected:** Emergency case created with auto-generated PRN (JMRH-ER-YYYY-NNNN)

### E2. Convert Emergency to IPD Admission

```bash
curl -X POST http://localhost:3000/api/emergency/{emergencyId}/convert-to-ipd \
  -H "Content-Type: application/json" \
  -d '{
    "wardId": "uuid-of-ward",
    "bedId": "uuid-of-available-bed",
    "admittingDoctorId": 1,
    "admittingDoctorName": "Dr. Johnson",
    "admissionType": "emergency"
  }'
```

**Expected:**
- IPD admission created with `sourceModule: 'emergency'`
- Emergency vitals auto-populated
- MLC case (if exists) linked to admission
- Room type set to ICU if triage = "red"

---

## HMIS Audit Trail Verification

### Check all HMIS sync operations

```bash
curl -X GET "http://localhost:3000/api/hmis-sync/audit-logs?status=success" \
  -H "Content-Type: application/json"
```

**Expected:** List of all successful HMIS push/pull operations with timestamps

### Check failed syncs (for troubleshooting)

```bash
curl -X GET "http://localhost:3000/api/hmis-sync/audit-logs?status=failed" \
  -H "Content-Type: application/json"
```

---

## Testing Checklist

- [ ] Ward created successfully
- [ ] Beds created for ward
- [ ] Available beds endpoint working
- [ ] Patient registration (auto-PRN generated)
- [ ] Patient synced to HMIS (check audit log)
- [ ] OPD appointment created
- [ ] OPD assessment recorded
- [ ] Investigation order created and synced to HMIS
- [ ] Prescription created and synced to HMIS
- [ ] OPD → IPD conversion successful
- [ ] Prescription carried over to IPD
- [ ] Carryover prescriptions reviewed
- [ ] Prescription continued in IPD
- [ ] Progress notes added (SOAP format)
- [ ] Medication administered (MAR logged)
- [ ] Discharge summary created
- [ ] Bed marked as available after discharge
- [ ] Ward census report accurate
- [ ] Patient transfer between beds working
- [ ] Emergency case created (auto-PRN)
- [ ] Emergency → IPD conversion successful
- [ ] HMIS audit trail complete

---

## Troubleshooting

### Issue: "Bed is already occupied"
**Solution:** Ensure you're using a different bed ID from the one already in use

### Issue: "IPD admission not found"
**Solution:** Verify the admissionId is correct (use UUID format)

### Issue: HMIS sync not logging
**Solution:** Check if HMIS_API_BASE_URL and HMIS_API_KEY are configured in .env
- Sync failures don't block main operations (by design)
- Check HmisAuditLog table for status="failed" entries

### Issue: Prescription carryover empty
**Solution:** Ensure OPD prescriptions exist and are created within last 7 days

---

## Database Tables Created

All tables are now present in `admin_panel` database:

- `IpdWard` - Ward master data
- `IpdBed` - Bed details and status
- `IpdAdmission` - Admission records with source tracking
- `IpdProgressNote` - SOAP notes during stay
- `IpdDischarge` - Discharge summaries
- `IpdPrescription` - IPD prescriptions with carryover tracking
- `IpdMedicationLog` - Medication Administration Record (MAR)

---

## API Endpoint Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| **WARD MANAGEMENT** |
| GET | `/api/ward/wards` | List all wards with census |
| GET | `/api/ward/wards/:wardId` | Get ward details |
| POST | `/api/ward/ward` | Create new ward |
| GET | `/api/ward/beds/available` | Get available beds |
| PUT | `/api/ward/bed/:bedId/status` | Update bed status |
| POST | `/api/ward/ward/:wardId/beds` | Create beds for ward |
| GET | `/api/ward/census-report` | Bed census report |
| **IPD ADMISSION** |
| POST | `/api/ipd/admission` | Create IPD admission |
| GET | `/api/ipd/admissions` | List active admissions |
| GET | `/api/ipd/admission/:id` | Get admission details |
| PUT | `/api/ipd/admission/:id` | Update admission |
| POST | `/api/ipd/admission/:id/progress-note` | Add SOAP note |
| GET | `/api/ipd/admission/:id/progress-notes` | Get progress notes |
| POST | `/api/ipd/admission/:id/discharge` | Create discharge |
| GET | `/api/ipd/admission/:id/discharge` | Get discharge summary |
| POST | `/api/ipd/admission/:id/transfer` | Transfer to another bed |
| **PHARMACY** |
| GET | `/api/ipd-pharmacy/admission/:id/review-carryover` | Review OPD/ER Rx |
| POST | `/api/ipd-pharmacy/admission/:id/continue` | Continue existing Rx |
| PUT | `/api/ipd-pharmacy/prescription/:id/modify` | Modify Rx |
| PUT | `/api/ipd-pharmacy/prescription/:id/discontinue` | Discontinue Rx |
| POST | `/api/ipd-pharmacy/admission/:id/prescription` | Create new Rx |
| GET | `/api/ipd-pharmacy/admission/:id/pending` | Pending medications |
| POST | `/api/ipd-pharmacy/prescription/:id/administer` | Mark administered (MAR) |
| GET | `/api/ipd-pharmacy/admission/:id/mar` | Get MAR history |

---

**Last Updated:** 2026-04-16  
**Implementation Status:** Phase 2 Complete - All IPD and Pharmacy endpoints ready for testing
