/**
 * Demo-data seed for the designation-tuned dashboards.
 *
 * Run with:
 *   npx ts-node prisma/seed-dashboard-demo.ts
 *   # or:
 *   npm run seed:demo
 *
 * Creates a realistic cross-section of activity so every chart on every
 * dashboard shows meaningful numbers:
 *   • ~20 doctors across 8 specialties
 *   • ~60 patients with varied demographics
 *   • ~120 appointments today + last 30d (mixed statuses)
 *   • ~25 active IPD admissions across 4 wards (with beds, vitals, meds)
 *   • ~30 OT schedules (today + history)
 *   • ~12 emergency cases (varied triage)
 *   • ~80 investigation orders + ~25% critical results
 *   • RevenueRollup rows for last 30 days
 *   • Staff shift assignments + duty acks for today
 *   • Pending bed requests, ICU step-downs, MLC/LAMA/DAMA, HMIS dead-letters
 *
 * Safety:
 *   1. Every row is tagged with `createdBy='DEMO_SEED'` where the field
 *      exists. A re-run deletes those rows before re-inserting, so it's
 *      idempotent and never touches real data.
 *   2. Refuses to run if DATABASE_URL contains 'prod' unless FORCE=1.
 *   3. Prints a summary of what will be deleted/created and waits 3s before
 *      executing so you can Ctrl+C if pointed at the wrong DB.
 *
 * Test credentials (all have password 'demo123'):
 *   • mgr.demo / sub_admin / Manager     → Management dashboard
 *   • fd.demo / sub_admin / Front Desk   → Front Desk dashboard
 *   • dr.cardio.demo / doctor (cardiology)
 *   • dr.ortho.demo / doctor (orthopedics)
 *   • dr.peds.demo / doctor (pediatrics)
 *   • dr.obgyn.demo / doctor (OB-GYN)
 *   • dr.er.demo / doctor (emergency medicine)
 *   • dr.med.demo / doctor (general medicine)
 *   • dr.surg.demo / doctor (general surgery)
 *   • nurse.b1.demo / sub_admin Nursing (employeeId B1) → Bedside Nurse
 *   • nurse.b2.demo / sub_admin Nursing (employeeId B2) → Bedside Nurse
 *   • super.demo / sub_admin Nursing (no block) → Nursing Superintendent
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { computeNews2, gcsToAcvpu } from '../src/service/news2-score';

const prisma = new PrismaClient();
const DEMO_MARKER = 'DEMO_SEED';
const DEMO_PASSWORD = 'demo123';

// ────────────────────────────────────────────────────────────────────────────
// SAFETY
// ────────────────────────────────────────────────────────────────────────────
function checkSafety(): void {
  const url = process.env.DATABASE_URL || '';
  if (url.toLowerCase().includes('prod') && !process.env.FORCE) {
    console.error(
      '⛔ DATABASE_URL contains "prod" — refusing to seed. Set FORCE=1 to override.',
    );
    process.exit(1);
  }
}

async function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}
function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 60 * 1000);
}
function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 1000);
}
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function formatTime12h(h: number, m: number): string {
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// ────────────────────────────────────────────────────────────────────────────
// CLEANUP — wipe prior demo rows in reverse FK order
// ────────────────────────────────────────────────────────────────────────────
async function deleteExistingDemoData(): Promise<void> {
  console.log('🧹 Deleting any prior DEMO_SEED rows…');

  // Order: children before parents, FKs respected via createdBy markers.
  await prisma.dutyAcknowledgement.deleteMany({ where: { user: { username: { contains: '.demo' } } } });
  await prisma.staffShiftAssignment.deleteMany({ where: { user: { username: { contains: '.demo' } } } });

  // ─── IPD admissions + every admissionId-keyed child ──────────────────
  // Collect demo admission IDs up-front, then delete every possible child
  // table by `admissionId IN (...)`. Bulletproof against FK-restrict — no
  // need to rely on each child carrying its own createdBy marker.
  const demoAdmissions = await prisma.ipdAdmission.findMany({
    where: { createdBy: DEMO_MARKER },
    select: { id: true },
  });
  const demoAdmissionIds = demoAdmissions.map((a) => a.id);
  if (demoAdmissionIds.length > 0) {
    const adm = { admissionId: { in: demoAdmissionIds } };
    await prisma.ipdMedicationLog.deleteMany({ where: adm });
    await prisma.ipdPrescription.deleteMany({ where: adm });
    await prisma.ipdNonDrugOrder.deleteMany({ where: adm });
    await prisma.ipdHandover.deleteMany({ where: adm });
    await prisma.ipdDailyClosure.deleteMany({ where: adm });
    await prisma.ipdDailyChart.deleteMany({ where: adm });
    await prisma.ipdIntakeOutputEntry.deleteMany({ where: adm });
    await prisma.ipdInitialAssessment.deleteMany({ where: adm });
    await prisma.ipdVitalsReading.deleteMany({ where: adm });
    await prisma.ipdDischarge.deleteMany({ where: adm });
    await prisma.admissionDiagnosisCode.deleteMany({ where: adm });
    await prisma.ipdBedRequest.deleteMany({ where: adm });
    await prisma.icuStepDownRequest.deleteMany({ where: adm });
    await prisma.ipdIcuTransferRequest.deleteMany({ where: adm });
    await prisma.icuVitalsReading.deleteMany({ where: adm });
    await prisma.icuProgressNote.deleteMany({ where: adm });
    await prisma.icuSedationLog.deleteMany({ where: adm });
    await prisma.icuRestraintLog.deleteMany({ where: adm });
    await prisma.icuBundleLog.deleteMany({ where: adm });
    await prisma.icuFamilyCommunication.deleteMany({ where: adm });
    await prisma.ipdProgressNote.deleteMany({ where: adm });
    // Phase 9.13 — Treatment Dashboard acuity rows (also cascade-deleted with
    // the admission, but cleared explicitly to match the file's belt-and-
    // braces cleanup style).
    await prisma.patientAcuitySnapshot.deleteMany({ where: adm });
    await prisma.acuityEscalation.deleteMany({ where: adm });
    await prisma.ipdInsulinInfusion.deleteMany({ where: adm });
    // OtSchedule.admissionId is nullable — null it out rather than delete
    // (a real OT schedule may have been booked against the demo admission).
    await prisma.otSchedule.updateMany({ where: adm, data: { admissionId: null } });
  }
  await prisma.ipdAdmission.deleteMany({ where: { createdBy: DEMO_MARKER } });

  await prisma.consentSignature.deleteMany({ where: { createdBy: DEMO_MARKER } });
  await prisma.signatureBlob.deleteMany({ where: { signerName: DEMO_MARKER } });

  // Results must go before their parent orders (FK is restrict-on-delete).
  // Scope by the order's demo doctorName so real results are never touched.
  await prisma.investigationResult.deleteMany({
    where: { order: { doctorName: { contains: 'Demo' } } },
  });
  await prisma.investigationOrder.deleteMany({ where: { doctorName: { contains: 'Demo' } } });

  await prisma.tablet.deleteMany({ where: { prescription: { prescribedBy: { contains: 'Demo' } } } });
  await prisma.prescription.deleteMany({ where: { prescribedBy: { contains: 'Demo' } } });

  await prisma.mlcCase.deleteMany({ where: { createdBy: DEMO_MARKER } });
  await prisma.lamaRecord.deleteMany({ where: { createdBy: DEMO_MARKER } });
  await prisma.damaRecord.deleteMany({ where: { createdBy: DEMO_MARKER } });

  await prisma.emergencyTreatment.deleteMany({ where: { emergency: { createdBy: DEMO_MARKER } } });
  await prisma.emergencyInvestigation.deleteMany({ where: { emergency: { createdBy: DEMO_MARKER } } });
  await prisma.emergencyProgressNote.deleteMany({ where: { emergency: { createdBy: DEMO_MARKER } } });
  await prisma.emergency.deleteMany({ where: { createdBy: DEMO_MARKER } });

  await prisma.dayCareSession.deleteMany({ where: { createdBy: DEMO_MARKER } });

  await prisma.otSchedule.deleteMany({ where: { createdBy: DEMO_MARKER } });

  await prisma.appointment.deleteMany({ where: { checkedInBy: DEMO_MARKER } });

  await prisma.allergy.deleteMany({ where: { notedBy: DEMO_MARKER } });

  await prisma.callbackRequest.deleteMany({ where: { name: { startsWith: 'Demo ' } } });

  await prisma.hmisDeadLetter.deleteMany({ where: { resolvedBy: DEMO_MARKER } });

  await prisma.revenueRollup.deleteMany({ where: { departmentName: { in: ['Cardiology', 'Orthopedics', 'Pediatrics', 'Obstetrics & Gynaecology', 'Emergency Medicine', 'General Medicine', 'General Surgery', 'Radiology'] } } });

  // Doctors / availability / patients: only wipe those linked to DEMO users.
  const demoUsers = await prisma.user.findMany({
    where: { username: { contains: '.demo' } },
    select: { id: true },
  });
  const demoUserIds = demoUsers.map((u) => u.id);
  if (demoUserIds.length > 0) {
    const demoDoctors = await prisma.doctor.findMany({
      where: { userId: { in: demoUserIds } },
      select: { id: true },
    });
    const demoDoctorIds = demoDoctors.map((d) => d.id);
    if (demoDoctorIds.length > 0) {
      await prisma.unavailableDates.deleteMany({ where: { doctorId: { in: demoDoctorIds } } });
      await prisma.doctorAvailability.deleteMany({ where: { doctorId: { in: demoDoctorIds } } });
      await prisma.bookedSlot.deleteMany({ where: { doctorId: { in: demoDoctorIds } } });
      await prisma.doctor.deleteMany({ where: { id: { in: demoDoctorIds } } });
    }
  }

  await prisma.patientDetails.deleteMany({ where: { createdBy: DEMO_MARKER } });
  await prisma.patient.deleteMany({ where: { prn: { gte: 900000 } } });

  // Wards + beds tagged via wardCode prefix.
  const demoWards = await prisma.ipdWard.findMany({
    where: { wardCode: { startsWith: 'DEMO-' } },
    select: { id: true },
  });
  if (demoWards.length > 0) {
    await prisma.ipdBed.deleteMany({ where: { wardId: { in: demoWards.map((w) => w.id) } } });
    await prisma.ipdWard.deleteMany({ where: { id: { in: demoWards.map((w) => w.id) } } });
  }

  await prisma.user.deleteMany({ where: { username: { contains: '.demo' } } });

  console.log('   …done.\n');
}

// ────────────────────────────────────────────────────────────────────────────
// DEPARTMENTS — upsert (don't blow away if exists)
// ────────────────────────────────────────────────────────────────────────────
const DEPARTMENTS = [
  'Cardiology',
  'Orthopedics',
  'Pediatrics',
  'Obstetrics & Gynaecology',
  'Emergency Medicine',
  'General Medicine',
  'General Surgery',
  'Radiology',
];

async function seedDepartments(): Promise<Record<string, number>> {
  console.log('🏥 Seeding departments…');
  const out: Record<string, number> = {};
  for (const name of DEPARTMENTS) {
    const row = await prisma.department.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    out[name] = row.id;
  }
  console.log(`   …${DEPARTMENTS.length} departments ready.\n`);
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// USERS — admin, reception, doctors, nurses, superintendent
// ────────────────────────────────────────────────────────────────────────────
interface UserSeed {
  username: string;
  role: 'admin' | 'sub_admin' | 'doctor' | 'super_admin';
  adminType?: string;
  subAdminType?: string;
  employeeId?: string;
  isReceptionist?: boolean;
}

const USERS: UserSeed[] = [
  // Management
  { username: 'mgr.demo', role: 'admin', adminType: 'Manager', employeeId: 'MGR001' },
  { username: 'snr.mgr.demo', role: 'admin', adminType: 'Senior Manager', employeeId: 'MGR002' },
  // Front Desk
  { username: 'fd.demo', role: 'sub_admin', subAdminType: 'Front Desk', employeeId: 'FD001', isReceptionist: true },
  { username: 'tele.demo', role: 'sub_admin', subAdminType: 'Tele Caller', employeeId: 'FD002' },
  // Doctors
  { username: 'dr.cardio.demo', role: 'doctor', employeeId: 'DC001' },
  { username: 'dr.ortho.demo', role: 'doctor', employeeId: 'DC002' },
  { username: 'dr.peds.demo', role: 'doctor', employeeId: 'DC003' },
  { username: 'dr.obgyn.demo', role: 'doctor', employeeId: 'DC004' },
  { username: 'dr.er.demo', role: 'doctor', employeeId: 'DC005' },
  { username: 'dr.med.demo', role: 'doctor', employeeId: 'DC006' },
  { username: 'dr.surg.demo', role: 'doctor', employeeId: 'DC007' },
  { username: 'dr.radio.demo', role: 'doctor', employeeId: 'DC008' },
  // Nurses (B<N> prefix → bedside nurse)
  { username: 'nurse.b1.demo', role: 'sub_admin', subAdminType: 'Nursing', employeeId: 'B1-N001' },
  { username: 'nurse.b1b.demo', role: 'sub_admin', subAdminType: 'Nursing', employeeId: 'B1-N002' },
  { username: 'nurse.b2.demo', role: 'sub_admin', subAdminType: 'Nursing', employeeId: 'B2-N001' },
  { username: 'nurse.b2b.demo', role: 'sub_admin', subAdminType: 'Nursing', employeeId: 'B2-N002' },
  { username: 'nurse.icu.demo', role: 'sub_admin', subAdminType: 'Nursing', employeeId: 'B3-N001' },
  // Nursing superintendent (no B<N> prefix)
  { username: 'super.demo', role: 'sub_admin', subAdminType: 'Nursing', employeeId: 'NS001' },
];

async function seedUsers(): Promise<Record<string, number>> {
  console.log('👤 Seeding users…');
  const hashed = await bcrypt.hash(DEMO_PASSWORD, 10);
  const out: Record<string, number> = {};
  for (const u of USERS) {
    const row = await prisma.user.create({
      data: {
        username: u.username,
        password: hashed,
        role: u.role,
        employeeId: u.employeeId,
        isReceptionist: u.isReceptionist || false,
        adminType: u.adminType,
        subAdminType: u.subAdminType,
        createdBy: DEMO_MARKER,
      },
    });
    out[u.username] = row.id;
  }
  console.log(`   …${USERS.length} users created (password: ${DEMO_PASSWORD}).\n`);
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// DOCTORS — linked to User records
// ────────────────────────────────────────────────────────────────────────────
interface DoctorSeed {
  username: string;
  name: string;
  department: string;
  qualification: string;
  phone: string;
  email: string;
  doctorType?: string;
}

const DOCTORS: DoctorSeed[] = [
  { username: 'dr.cardio.demo', name: 'Anjali Rao', department: 'Cardiology', qualification: 'MD, DM Cardiology', phone: '9810000001', email: 'anjali.rao@demo.in' },
  { username: 'dr.ortho.demo', name: 'Rakesh Iyer', department: 'Orthopedics', qualification: 'MS Ortho', phone: '9810000002', email: 'rakesh.iyer@demo.in' },
  { username: 'dr.peds.demo', name: 'Priya Mehta', department: 'Pediatrics', qualification: 'MD Pediatrics', phone: '9810000003', email: 'priya.mehta@demo.in' },
  { username: 'dr.obgyn.demo', name: 'Lakshmi Reddy', department: 'Obstetrics & Gynaecology', qualification: 'MS OB-GYN', phone: '9810000004', email: 'lakshmi.reddy@demo.in' },
  { username: 'dr.er.demo', name: 'Vikram Singh', department: 'Emergency Medicine', qualification: 'MD Emergency', phone: '9810000005', email: 'vikram.singh@demo.in' },
  { username: 'dr.med.demo', name: 'Sunita Kapoor', department: 'General Medicine', qualification: 'MD General Medicine', phone: '9810000006', email: 'sunita.kapoor@demo.in' },
  { username: 'dr.surg.demo', name: 'Arjun Nair', department: 'General Surgery', qualification: 'MS General Surgery', phone: '9810000007', email: 'arjun.nair@demo.in' },
  { username: 'dr.radio.demo', name: 'Meera Krishnan', department: 'Radiology', qualification: 'MD Radiology', phone: '9810000008', email: 'meera.krishnan@demo.in' },
];

async function seedDoctors(
  userIds: Record<string, number>,
  deptIds: Record<string, number>,
): Promise<Record<string, number>> {
  console.log('🩺 Seeding doctors…');
  const out: Record<string, number> = {};
  for (const d of DOCTORS) {
    const row = await prisma.doctor.create({
      data: {
        name: d.name,
        email: d.email,
        phone_number: d.phone,
        qualification: d.qualification,
        departmentId: deptIds[d.department],
        departmentName: d.department,
        userId: userIds[d.username],
        availableFrom: '09:00 AM',
        slotDuration: 20,
        doctorType: d.doctorType || 'Regular',
        roomNo: `R-${randInt(101, 220)}`,
        createdBy: DEMO_MARKER,
      },
    });
    out[d.username] = row.id;
    // 7-day availability rotation (Mon-Sun) — batched
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    await prisma.doctorAvailability.createMany({
      data: days.map((day) => ({
        doctorId: row.id,
        day,
        availableFrom: '09:00 AM',
        slotDuration: 20,
        createdBy: DEMO_MARKER,
      })),
    });
  }
  console.log(`   …${DOCTORS.length} doctors created.\n`);
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// PATIENTS — Patient + PatientDetails
// ────────────────────────────────────────────────────────────────────────────
const FIRST_NAMES_M = ['Aarav', 'Ravi', 'Karan', 'Suresh', 'Mahesh', 'Arjun', 'Rohan', 'Vikram', 'Akash', 'Kiran', 'Sanjay', 'Manish', 'Naveen', 'Deepak'];
const FIRST_NAMES_F = ['Ananya', 'Kavya', 'Pooja', 'Asha', 'Lakshmi', 'Meera', 'Deepa', 'Sneha', 'Priya', 'Nisha', 'Sunita', 'Geeta', 'Roshni', 'Tara'];
const LAST_NAMES = ['Kumar', 'Patel', 'Sharma', 'Iyer', 'Reddy', 'Nair', 'Rao', 'Singh', 'Mehta', 'Joshi', 'Bhat', 'Gowda', 'Pillai', 'Verma'];
const BLOOD_GROUPS = ['A+', 'B+', 'O+', 'AB+', 'A-', 'B-', 'O-'];

async function seedPatients(): Promise<Array<{ prn: number; name: string; age: number; gender: 'M' | 'F' }>> {
  console.log('👥 Seeding patients…');
  const N = 60;
  const out: Array<{ prn: number; name: string; age: number; gender: 'M' | 'F' }> = [];
  const patientRows: Array<any> = [];
  const detailRows: Array<any> = [];
  let basePrn = 900001;
  for (let i = 0; i < N; i++) {
    const isMale = Math.random() > 0.45;
    const first = isMale ? pickRandom(FIRST_NAMES_M) : pickRandom(FIRST_NAMES_F);
    const last = pickRandom(LAST_NAMES);
    const name = `${first} ${last}`;
    let age: number;
    const r = Math.random();
    if (r < 0.3) age = randInt(1, 12);
    else if (r < 0.8) age = randInt(13, 60);
    else age = randInt(61, 85);
    const gender: 'M' | 'F' = isMale ? 'M' : 'F';
    const prn = basePrn++;
    patientRows.push({
      prn,
      name,
      phoneNumber: `98${String(randInt(10000000, 99999999))}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@demo.in`,
      age,
      gender: isMale ? 1 : 2,
    });
    detailRows.push({
      prn,
      name,
      mobileNo: `98${String(randInt(10000000, 99999999))}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@demo.in`,
      age: String(age),
      gender: isMale ? 'male' : 'female',
      bloodGroup: pickRandom(BLOOD_GROUPS),
      patientType: pickRandom(['new', 'follow-up', 'referral']),
      city: pickRandom(['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi']),
      state: 'Karnataka',
      country: 'India',
      createdBy: DEMO_MARKER,
    });
    out.push({ prn, name, age, gender });
  }
  await prisma.patient.createMany({ data: patientRows });
  await prisma.patientDetails.createMany({ data: detailRows });
  console.log(`   …${N} patients created.\n`);
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// WARDS + BEDS
// ────────────────────────────────────────────────────────────────────────────
const WARDS = [
  { name: 'Block 1 — General Ward', code: 'DEMO-B1-GEN', floor: '1', department: 'General Medicine', beds: 12 },
  { name: 'Block 2 — Surgical Ward', code: 'DEMO-B2-SURG', floor: '2', department: 'General Surgery', beds: 10 },
  { name: 'Block 3 — ICU', code: 'DEMO-B3-ICU', floor: '3', department: 'Critical Care', beds: 6 },
  { name: 'Block 4 — Pediatric Ward', code: 'DEMO-B4-PEDS', floor: '1', department: 'Pediatrics', beds: 8 },
  { name: 'Maternity Ward', code: 'DEMO-MAT', floor: '2', department: 'Obstetrics & Gynaecology', beds: 8 },
];

async function seedWardsAndBeds(): Promise<{
  wards: Array<{ id: string; code: string; name: string }>;
  beds: Array<{ id: string; wardId: string; bedNumber: string; type: string }>;
}> {
  console.log('🛏️  Seeding wards & beds…');
  const wards: Array<{ id: string; code: string; name: string }> = [];
  const beds: Array<{ id: string; wardId: string; bedNumber: string; type: string }> = [];
  for (const w of WARDS) {
    const ward = await prisma.ipdWard.create({
      data: {
        wardName: w.name,
        wardCode: w.code,
        floor: w.floor,
        department: w.department,
        totalBeds: w.beds,
      },
    });
    wards.push({ id: ward.id, code: ward.wardCode, name: ward.wardName });
    const bedType = w.code.includes('ICU') ? 'ICU' : 'general';
    const bedRows = [];
    for (let i = 1; i <= w.beds; i++) {
      bedRows.push({
        bedNumber: `${w.code.split('-').pop()}-${String(i).padStart(2, '0')}`,
        wardId: ward.id,
        bedType,
        status: 'available',
      });
    }
    await prisma.ipdBed.createMany({ data: bedRows });
    // Re-fetch with IDs (createMany doesn't return them).
    const createdBeds = await prisma.ipdBed.findMany({
      where: { wardId: ward.id },
      select: { id: true, bedNumber: true },
    });
    for (const b of createdBeds) {
      beds.push({ id: b.id, wardId: ward.id, bedNumber: b.bedNumber, type: bedType });
    }
  }
  console.log(`   …${wards.length} wards, ${beds.length} beds created.\n`);
  return { wards, beds };
}

// ────────────────────────────────────────────────────────────────────────────
// APPOINTMENTS — today + last 30 days, mixed statuses
// ────────────────────────────────────────────────────────────────────────────
async function seedAppointments(
  patients: Array<{ prn: number; name: string; age: number; gender: 'M' | 'F' }>,
  doctorIds: Record<string, number>,
  doctorDeptMap: Record<string, string>,
): Promise<void> {
  console.log('📅 Seeding appointments…');
  const now = new Date();
  const docKeys = Object.keys(doctorIds);
  const todayRows: any[] = [];
  const historyRows: any[] = [];

  // Today: 30-40 appointments. Spread 09:00-17:00. Mix of statuses by current time.
  const todayYmd = ymd(now);
  for (let i = 0; i < 35; i++) {
    const p = pickRandom(patients);
    const docKey = pickRandom(docKeys);
    const doctorId = doctorIds[docKey];
    const department = doctorDeptMap[docKey];
    const doctorName = DOCTORS.find((d) => d.username === docKey)?.name || 'Demo';

    const hour = randInt(9, 17);
    const minute = pickRandom([0, 20, 40]);
    const apptTime = formatTime12h(hour, minute);
    const apptMinutes = hour * 60 + minute;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    let status: 'pending' | 'confirmed' | 'completed' | 'cancelled' = 'pending';
    let checkedIn = false;
    let arrived = false;
    let endConsultation = false;
    let checkedInTime: Date | null = null;
    let arrivedTime: Date | null = null;
    let endConsultationTime: Date | null = null;

    if (apptMinutes < nowMinutes - 60) {
      const r = Math.random();
      if (r < 0.7) {
        status = 'completed';
        endConsultation = true;
        checkedIn = true;
        arrived = true;
        const apptDate = new Date(now);
        apptDate.setHours(hour, minute, 0, 0);
        checkedInTime = new Date(apptDate.getTime() - randInt(5, 20) * 60000);
        arrivedTime = new Date(apptDate.getTime() + randInt(5, 25) * 60000);
        endConsultationTime = new Date(arrivedTime.getTime() + randInt(10, 30) * 60000);
      } else if (r < 0.85) {
        status = 'cancelled';
      } else {
        // No-show
        status = 'confirmed';
      }
    } else if (apptMinutes <= nowMinutes + 30 && apptMinutes >= nowMinutes - 30) {
      // Currently waiting — checked-in but not done
      status = 'confirmed';
      checkedIn = Math.random() > 0.3;
      arrived = checkedIn && Math.random() > 0.5;
      if (checkedIn) {
        checkedInTime = new Date(Date.now() - randInt(5, 40) * 60000);
      }
      if (arrived) {
        arrivedTime = new Date(Date.now() - randInt(2, 20) * 60000);
      }
    } else {
      // Future appointment
      status = Math.random() > 0.3 ? 'confirmed' : 'pending';
    }

    todayRows.push({
      patientName: p.name,
      phoneNumber: `98${randInt(10000000, 99999999)}`,
      email: `${p.name.toLowerCase().replace(/\s/g, '.')}@demo.in`,
      doctorId,
      doctorName,
      department,
      date: todayYmd,
      time: apptTime,
      status,
      prnNumber: p.prn,
      checkedIn,
      checkedInTime,
      arrived,
      arrivedTime,
      endConsultation,
      endConsultationTime,
      age: String(p.age),
      gender: p.gender === 'M' ? 'Male' : 'Female',
      requestVia: pickRandom(['walk-in', 'whatsapp', 'phone', 'web']),
      smsSent: Math.random() > 0.4,
      emailSent: Math.random() > 0.6,
      messageSent: Math.random() > 0.5,
      isNew: Math.random() > 0.6,
      isfollowup: Math.random() > 0.7,
      isReferred: Math.random() > 0.85,
      patientType: pickRandom(['new', 'follow-up', 'referral']),
      type: pickRandom(['OPD', 'Follow-up', 'Consultation']),
      BPs: String(randInt(110, 145)),
      BPd: String(randInt(70, 95)),
      pulse: String(randInt(60, 100)),
      spo2: String(randInt(94, 99)),
      temp: String(randInt(97, 101)),
      checkedInBy: DEMO_MARKER,
    });
  }

  // History: last 30 days, ~3-5 per day per a sample of doctors.
  for (let dayBack = 1; dayBack <= 30; dayBack++) {
    const date = daysAgo(dayBack);
    const dateStr = ymd(date);
    const daily = randInt(15, 30);
    for (let i = 0; i < daily; i++) {
      const p = pickRandom(patients);
      const docKey = pickRandom(docKeys);
      const doctorId = doctorIds[docKey];
      const department = doctorDeptMap[docKey];
      const doctorName = DOCTORS.find((d) => d.username === docKey)?.name || 'Demo';

      const hour = randInt(9, 17);
      const minute = pickRandom([0, 20, 40]);
      const apptDate = new Date(date);
      apptDate.setHours(hour, minute, 0, 0);

      // 70% completed, 15% cancelled, 15% no-show
      const r = Math.random();
      let status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
      let endConsultation = false;
      let checkedIn = false;
      let checkedInTime: Date | null = null;
      let arrivedTime: Date | null = null;
      let endConsultationTime: Date | null = null;

      if (r < 0.7) {
        status = 'completed';
        endConsultation = true;
        checkedIn = true;
        checkedInTime = new Date(apptDate.getTime() - randInt(5, 20) * 60000);
        arrivedTime = new Date(apptDate.getTime() + randInt(5, 25) * 60000);
        endConsultationTime = new Date(arrivedTime.getTime() + randInt(10, 30) * 60000);
      } else if (r < 0.85) {
        status = 'cancelled';
      } else {
        status = 'confirmed';
      }

      historyRows.push({
        patientName: p.name,
        phoneNumber: `98${randInt(10000000, 99999999)}`,
        email: `${p.name.toLowerCase().replace(/\s/g, '.')}@demo.in`,
        doctorId,
        doctorName,
        department,
        date: dateStr,
        time: formatTime12h(hour, minute),
        status,
        prnNumber: p.prn,
        checkedIn,
        checkedInTime,
        arrivedTime,
        endConsultation,
        endConsultationTime,
        age: String(p.age),
        gender: p.gender === 'M' ? 'Male' : 'Female',
        requestVia: pickRandom(['walk-in', 'whatsapp', 'phone', 'web']),
        smsSent: Math.random() > 0.4,
        emailSent: Math.random() > 0.6,
        messageSent: Math.random() > 0.5,
        isNew: Math.random() > 0.6,
        isfollowup: Math.random() > 0.7,
        isReferred: Math.random() > 0.85,
        patientType: pickRandom(['new', 'follow-up', 'referral']),
        type: pickRandom(['OPD', 'Follow-up', 'Consultation']),
        checkedInBy: DEMO_MARKER,
      });
    }
  }

  // Batch insert in chunks of 200 to keep packet size sane.
  async function batchInsert(rows: any[]): Promise<void> {
    for (let i = 0; i < rows.length; i += 200) {
      await prisma.appointment.createMany({ data: rows.slice(i, i + 200) });
    }
  }
  await batchInsert(todayRows);
  await batchInsert(historyRows);

  console.log(`   …${todayRows.length} today + ${historyRows.length} history.\n`);
}

// ────────────────────────────────────────────────────────────────────────────
// ADMISSIONS — across wards, with prescriptions, vitals, orders
// ────────────────────────────────────────────────────────────────────────────
const DIAGNOSES = [
  'Acute coronary syndrome',
  'Community-acquired pneumonia',
  'Type 2 diabetes mellitus with hyperglycemia',
  'Acute appendicitis',
  'Post-op total knee replacement',
  'Severe dengue fever',
  'Hypertensive emergency',
  'Acute gastroenteritis with dehydration',
  'Chronic obstructive pulmonary disease — acute exacerbation',
  'Stroke — middle cerebral artery infarct',
  'Sepsis from urinary source',
  'Antenatal — 32 weeks, mild preeclampsia',
  'Post-natal — uncomplicated vaginal delivery',
  'Pediatric bronchiolitis',
];

const COMMON_MEDS = [
  { generic: 'Paracetamol', brand: 'Crocin', dose: '500 mg', freq: 'TID', route: 'oral' },
  { generic: 'Amoxicillin', brand: 'Mox', dose: '500 mg', freq: 'BID', route: 'oral' },
  { generic: 'Metformin', brand: 'Glycomet', dose: '500 mg', freq: 'BID', route: 'oral' },
  { generic: 'Amlodipine', brand: 'Amlong', dose: '5 mg', freq: 'OD', route: 'oral' },
  { generic: 'Atorvastatin', brand: 'Lipitor', dose: '20 mg', freq: 'HS', route: 'oral' },
  { generic: 'Pantoprazole', brand: 'Pan', dose: '40 mg', freq: 'OD', route: 'iv' },
  { generic: 'Ceftriaxone', brand: 'Monocef', dose: '1 g', freq: 'BID', route: 'iv' },
  { generic: 'Furosemide', brand: 'Lasix', dose: '40 mg', freq: 'OD', route: 'iv' },
  { generic: 'Insulin Regular', brand: 'Actrapid', dose: '10 U', freq: 'TID', route: 'sc' },
  { generic: 'Heparin', brand: 'Heparin', dose: '5000 U', freq: 'BID', route: 'sc' },
];

const ALLERGENS = ['Penicillin', 'Sulfa drugs', 'Aspirin', 'Iodine', 'Latex', 'Peanuts'];

async function seedAdmissions(
  patients: Array<{ prn: number; name: string; age: number; gender: 'M' | 'F' }>,
  beds: Array<{ id: string; wardId: string; bedNumber: string; type: string }>,
  doctorNames: string[],
): Promise<Array<{ admissionId: string; prn: string; wardId: string }>> {
  console.log('🛏️  Seeding admissions, vitals, prescriptions…');
  const now = new Date();
  const adultPatients = patients.filter((p) => p.age > 12);
  const N = 25;
  const out: Array<{ admissionId: string; prn: string; wardId: string }> = [];
  const shuffledBeds = [...beds].sort(() => Math.random() - 0.5);
  const usedBedIds = new Set<string>();

  // Batch collectors — flushed after the loop to avoid N round-trips per
  // admission. Each admission contributes ~10 child rows (vitals, meds,
  // diagnosis codes, etc.) so the savings are big on a remote DB.
  const allergyRows: any[] = [];
  const vitalsRows: any[] = [];
  const initialAssessmentRows: any[] = [];
  const prescriptionRows: any[] = [];
  const nonDrugOrderRows: any[] = [];
  const diagnosisCodeRows: any[] = [];
  const dischargeRows: any[] = [];
  const occupiedBedIds: string[] = [];

  for (let i = 0; i < N; i++) {
    const p = adultPatients[i % adultPatients.length];
    // Pick an available bed.
    const bed = shuffledBeds.find((b) => !usedBedIds.has(b.id));
    if (!bed) break;
    usedBedIds.add(bed.id);

    const daysSinceAdmit = randInt(1, 14);
    const admissionDate = daysAgo(daysSinceAdmit);
    const isIcu = bed.type === 'ICU' || Math.random() < 0.15;
    const doctorName = pickRandom(doctorNames);

    const admission = await prisma.ipdAdmission.create({
      data: {
        admissionNo: `ADM-DEMO-${String(900 + i).padStart(4, '0')}`,
        prn: String(p.prn),
        admissionDate,
        admissionTime: formatTime12h(randInt(8, 20), pickRandom([0, 30])),
        admissionType: pickRandom(['elective', 'emergency']),
        sourceModule: pickRandom(['opd', 'emergency', 'direct']),
        admittingDoctor: doctorName,
        department: pickRandom(DEPARTMENTS),
        wardId: bed.wardId,
        bedId: bed.id,
        roomType: isIcu ? 'ICU' : pickRandom(['general', 'semi-private', 'private']),
        diagnosis: pickRandom(DIAGNOSES),
        status: 'admitted',
        icuAdmittedAt: isIcu ? hoursAgo(randInt(2, 72)) : null,
        // Phase 9.13 — doctor-ordered vitals monitoring frequency. ICU gets a
        // tight order; ward patients vary, and ~1 in 4 is left unset so the
        // dashboard shows both "ordered" and "no order" states.
        vitalsMonitoringFrequency: isIcu
          ? pickRandom(['1h', '2h'])
          : (Math.random() < 0.25 ? null : pickRandom(['4h', '6h', '8h', 'bd'])),
        vitalsMonitoringSetBy: doctorName,
        vitalsMonitoringSetAt: admissionDate,
        createdBy: DEMO_MARKER,
        updatedBy: DEMO_MARKER,
      },
    });
    out.push({ admissionId: admission.id, prn: admission.prn, wardId: bed.wardId });
    occupiedBedIds.push(bed.id);

    // Allergies — 30% of patients have one
    if (Math.random() < 0.3) {
      allergyRows.push({
        prn: String(p.prn),
        genericName: pickRandom(ALLERGENS),
        notedBy: DEMO_MARKER,
      });
    }

    // Vitals — 4 readings across last 24h. Last one is either recent (4h ago)
    // or overdue (>4h ago) so the overdue-vitals KPI shows variation.
    const vitalsAges = [randInt(1, 6), 8, 14, 22];
    for (const h of vitalsAges) {
      const spo2 = isIcu && Math.random() < 0.3 ? randInt(86, 91) : randInt(94, 99);
      const temp = Math.random() < 0.2 ? 38 + Math.random() * 1.5 : 36.5 + Math.random() * 1;
      vitalsRows.push({
        admissionId: admission.id,
        recordedAt: hoursAgo(h),
        shift: h < 8 ? 'M' : h < 16 ? 'E' : 'N',
        bpSystolic: randInt(105, 150),
        bpDiastolic: randInt(65, 95),
        pulse: randInt(60, 110),
        respiration: randInt(14, 22),
        spo2,
        temperatureC: Math.round(temp * 10) / 10,
        painScore: randInt(0, 6),
        recordedBy: DEMO_MARKER,
      });
    }

    // Initial assessment — pregnancy/lactation random for OB-GYN admissions
    const isOb = admission.admittingDoctor.includes('Lakshmi');
    if (isOb || Math.random() < 0.05) {
      initialAssessmentRows.push({
        admissionId: admission.id,
        department: 'Obstetrics & Gynaecology',
        admittingConsultant: doctorName,
        isPregnant: isOb && Math.random() > 0.3,
        pregnancyWeeks: isOb ? randInt(20, 38) : null,
        isLactating: !isOb || Math.random() > 0.7,
        chiefComplaints: 'Routine antenatal review',
        presentingIllness: 'Stable pregnancy at term',
      });
    }

    // Prescriptions — 2-3 active meds per admission
    const numMeds = randInt(2, 4);
    for (let m = 0; m < numMeds; m++) {
      const med = pickRandom(COMMON_MEDS);
      const r = Math.random();
      let nextAdmin: Date;
      if (r < 0.1) {
        nextAdmin = minutesAgo(randInt(15, 90));
      } else if (r < 0.4) {
        nextAdmin = new Date(Date.now() + randInt(5, 55) * 60000);
      } else {
        nextAdmin = new Date(Date.now() + randInt(2, 12) * 60 * 60000);
      }
      prescriptionRows.push({
        admissionId: admission.id,
        prescribedBy: doctorName + ' (Demo)',
        prescribedDate: admissionDate,
        genericName: med.generic,
        brandName: med.brand,
        dose: med.dose,
        frequency: med.freq,
        duration: '7 days',
        route: med.route,
        quantity: 21,
        adminStatus: 'pending',
        status: 'active',
        nextAdminTime: nextAdmin,
      });
    }

    // Non-drug orders — 30% of admissions have a pending order
    if (Math.random() < 0.35) {
      nonDrugOrderRows.push({
        admissionId: admission.id,
        doctorName: doctorName + ' (Demo)',
        orderText: pickRandom([
          'Chest X-ray PA view',
          'Repeat CBC + ESR',
          '2D Echo',
          'Cardiology consult',
          'Physiotherapy — bedside',
          'Diet review',
        ]),
        category: pickRandom(['investigation', 'consult', 'diet', 'procedure']),
        status: 'ORDERED',
        createdBy: DEMO_MARKER,
      });
    }

    // ICD diagnosis codes — 1 provisional per admission
    diagnosisCodeRows.push({
      admissionId: admission.id,
      category: 'icd-provisional',
      code: pickRandom(['I21.9', 'J18.9', 'E11.65', 'K35.80', 'M17.0', 'A91', 'I16.9', 'A09']),
      description: pickRandom(DIAGNOSES),
      createdBy: DEMO_MARKER,
    });

    // Pending unsigned discharge for ~30% of admissions
    if (Math.random() < 0.3) {
      dischargeRows.push({
        admissionId: admission.id,
        dischargeDate: hoursAgo(randInt(2, 24)),
        dischargeTime: formatTime12h(randInt(9, 18), 0),
        dischargeType: 'regular',
        finalDiagnosis: admission.diagnosis,
        conditionAtDischarge: 'Stable',
        dischargeSummary: 'AI-drafted summary pending review',
        medications: '[]',
        summaryStatus: pickRandom(['DRAFTED', 'EDITED']),
        createdBy: DEMO_MARKER,
      });
    }
  }

  // Batch flush all admission-child rows.
  if (occupiedBedIds.length > 0) {
    await prisma.ipdBed.updateMany({
      where: { id: { in: occupiedBedIds } },
      data: { status: 'occupied' },
    });
  }
  if (allergyRows.length > 0) await prisma.allergy.createMany({ data: allergyRows });
  if (vitalsRows.length > 0) await prisma.ipdVitalsReading.createMany({ data: vitalsRows });
  if (initialAssessmentRows.length > 0) await prisma.ipdInitialAssessment.createMany({ data: initialAssessmentRows });
  if (prescriptionRows.length > 0) await prisma.ipdPrescription.createMany({ data: prescriptionRows });
  if (nonDrugOrderRows.length > 0) await prisma.ipdNonDrugOrder.createMany({ data: nonDrugOrderRows });
  if (diagnosisCodeRows.length > 0) await prisma.admissionDiagnosisCode.createMany({ data: diagnosisCodeRows });
  if (dischargeRows.length > 0) await prisma.ipdDischarge.createMany({ data: dischargeRows });

  console.log(`   …${out.length} admissions with vitals/meds/orders.\n`);
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// BED REQUESTS + ICU STEP-DOWN (nursing-superintendent)
// ────────────────────────────────────────────────────────────────────────────
async function seedNursingSupportingData(
  admissions: Array<{ admissionId: string; wardId: string }>,
): Promise<void> {
  console.log('📋 Seeding bed requests, ICU step-downs, handovers…');
  // 4 pending bed requests
  for (let i = 0; i < 4; i++) {
    const a = pickRandom(admissions);
    await prisma.ipdBedRequest.create({
      data: {
        admissionId: a.admissionId,
        wardId: a.wardId,
        preferredBedType: pickRandom(['general', 'private', 'ICU']),
        urgency: pickRandom(['routine', 'urgent', 'emergency']),
        status: 'REQUESTED',
        requestedAt: minutesAgo(randInt(10, 180)),
        requestedBy: DEMO_MARKER,
      },
    });
  }
  // 2 ICU step-down requests
  for (let i = 0; i < 2; i++) {
    const a = pickRandom(admissions);
    await prisma.icuStepDownRequest.create({
      data: {
        admissionId: a.admissionId,
        fromWardId: a.wardId,
        rationale: 'Off pressors, GCS 15, stable for 24h',
        stepDownCriteriaMet: true,
        proposedBy: DEMO_MARKER,
        status: pickRandom(['PROPOSED', 'ACKNOWLEDGED']),
      },
    });
  }
  // 3 pending handovers
  for (let i = 0; i < 3; i++) {
    const a = pickRandom(admissions);
    await prisma.ipdHandover.create({
      data: {
        admissionId: a.admissionId,
        chartDate: daysAgo(0),
        shift: pickRandom(['M', 'E', 'N']),
        currentProblems: 'Stable, monitor vitals q4h',
        status: pickRandom(['DRAFT', 'HANDED_OVER']),
        createdBy: DEMO_MARKER,
      } as any,
    });
  }
  console.log('   …done.\n');
}

// ────────────────────────────────────────────────────────────────────────────
// OT SCHEDULES — today + history
// ────────────────────────────────────────────────────────────────────────────
const PROCEDURES = [
  { name: 'Total knee replacement', urgency: 'elective', duration: 180 },
  { name: 'Laparoscopic appendectomy', urgency: 'urgent', duration: 60 },
  { name: 'Coronary angioplasty', urgency: 'urgent', duration: 90 },
  { name: 'Cesarean section', urgency: 'urgent', duration: 60 },
  { name: 'Cataract surgery', urgency: 'elective', duration: 30 },
  { name: 'Inguinal hernia repair', urgency: 'elective', duration: 75 },
  { name: 'Tonsillectomy', urgency: 'elective', duration: 45 },
  { name: 'Open cholecystectomy', urgency: 'urgent', duration: 120 },
];

async function seedOtSchedules(
  doctorIds: Record<string, number>,
  patients: Array<{ name: string; prn: number }>,
): Promise<void> {
  console.log('🔬 Seeding OT schedules…');
  // Need an OtRoom — find or use first available.
  const rooms = await prisma.otRoom.findMany({ select: { id: true, name: true } });
  if (rooms.length === 0) {
    console.log('   ⚠️  No OT rooms exist — skipping (run prisma/seed-ot-rooms.ts first).');
    return;
  }

  const surgeons = ['dr.surg.demo', 'dr.ortho.demo', 'dr.obgyn.demo', 'dr.cardio.demo'];

  // Today: 6 schedules
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 6; i++) {
    const proc = pickRandom(PROCEDURES);
    const surgKey = pickRandom(surgeons);
    const surgeonId = doctorIds[surgKey];
    const surgeonName = DOCTORS.find((d) => d.username === surgKey)?.name || 'Demo';
    const room = pickRandom(rooms);
    const patient = pickRandom(patients);

    const startHour = 8 + i * 2;
    const plannedStart = new Date(today);
    plannedStart.setHours(startHour, 0, 0, 0);
    const plannedEnd = new Date(plannedStart.getTime() + proc.duration * 60000);

    const now = new Date();
    let status = 'BOOKED';
    let actualStart: Date | null = null;
    let actualEnd: Date | null = null;
    if (plannedEnd < now) {
      status = 'CLOSED';
      actualStart = new Date(plannedStart.getTime() + randInt(-5, 25) * 60000);
      actualEnd = new Date(actualStart.getTime() + (proc.duration + randInt(-10, 30)) * 60000);
    } else if (plannedStart < now && plannedEnd > now) {
      status = 'IN_PROGRESS';
      actualStart = new Date(plannedStart.getTime() + randInt(-5, 20) * 60000);
    }

    await prisma.otSchedule.create({
      data: {
        otRoomId: room.id,
        date: today,
        plannedStart,
        plannedEnd,
        actualStart,
        actualEnd,
        surgeonId,
        surgeonName,
        procedureName: proc.name,
        urgency: proc.urgency,
        status,
        patientName: patient.name,
        prn: String(patient.prn),
        createdBy: DEMO_MARKER,
      },
    });
  }

  // History: ~30 schedules over last 30 days — batched
  const otHistoryRows: any[] = [];
  for (let dayBack = 1; dayBack <= 30; dayBack++) {
    const date = daysAgo(dayBack);
    const dailyCount = randInt(0, 2);
    for (let i = 0; i < dailyCount; i++) {
      const proc = pickRandom(PROCEDURES);
      const surgKey = pickRandom(surgeons);
      const surgeonId = doctorIds[surgKey];
      const surgeonName = DOCTORS.find((d) => d.username === surgKey)?.name || 'Demo';
      const room = pickRandom(rooms);

      const startHour = randInt(8, 16);
      const plannedStart = new Date(date);
      plannedStart.setHours(startHour, 0, 0, 0);
      const plannedEnd = new Date(plannedStart.getTime() + proc.duration * 60000);
      const actualStart = new Date(plannedStart.getTime() + randInt(-5, 35) * 60000);
      const actualEnd = new Date(actualStart.getTime() + (proc.duration + randInt(-15, 40)) * 60000);

      const status = Math.random() < 0.08 ? 'CANCELLED' : 'CLOSED';

      otHistoryRows.push({
        otRoomId: room.id,
        date,
        plannedStart,
        plannedEnd,
        actualStart: status === 'CANCELLED' ? null : actualStart,
        actualEnd: status === 'CANCELLED' ? null : actualEnd,
        surgeonId,
        surgeonName,
        procedureName: proc.name,
        urgency: proc.urgency,
        status,
        patientName: pickRandom(patients).name,
        prn: String(pickRandom(patients).prn),
        createdBy: DEMO_MARKER,
      });
    }
  }
  if (otHistoryRows.length > 0) {
    await prisma.otSchedule.createMany({ data: otHistoryRows });
  }

  console.log('   …done.\n');
}

// ────────────────────────────────────────────────────────────────────────────
// EMERGENCY CASES + MLC + LAMA + DAMA
// ────────────────────────────────────────────────────────────────────────────
const COMPLAINTS = [
  'Chest pain with radiation to left arm',
  'RTA — fractured tibia, multiple abrasions',
  'Severe abdominal pain — query appendicitis',
  'High-grade fever for 4 days',
  'Sudden-onset slurred speech and right-sided weakness',
  'Snake bite — left foot',
  'Severe headache and photophobia',
  'Breathlessness with wheeze',
];

async function seedEmergency(): Promise<void> {
  console.log('🚑 Seeding emergency cases…');
  const triages: Array<'red' | 'yellow' | 'green'> = ['red', 'red', 'yellow', 'yellow', 'yellow', 'green', 'green', 'green', 'green', 'green'];
  const N = 12;
  for (let i = 0; i < N; i++) {
    const ageBucket = Math.random();
    const age = ageBucket < 0.2 ? randInt(2, 14) : ageBucket < 0.8 ? randInt(20, 60) : randInt(60, 85);
    const gender = Math.random() > 0.5 ? 'male' : 'female';
    const triage = pickRandom(triages);
    const status = i < 8 ? pickRandom(['arrived', 'stabilized']) : pickRandom(['admitted-ipd', 'discharged']);
    const createdAt = minutesAgo(randInt(5, 720));
    const isMlc = Math.random() < 0.2;
    const emer = await prisma.emergency.create({
      data: {
        prn: `DEMO-ER-${String(900 + i).padStart(3, '0')}`,
        patientName: `${pickRandom(gender === 'male' ? FIRST_NAMES_M : FIRST_NAMES_F)} ${pickRandom(LAST_NAMES)}`,
        age,
        gender,
        triageCategory: triage,
        presentingComplaint: pickRandom(COMPLAINTS),
        abcdeAssessment: 'A: patent. B: spontaneous. C: HR 110, BP 100/70. D: GCS 14. E: minor abrasion.',
        traumaScore: triage === 'red' ? randInt(15, 30) : null,
        vitalsBP: `${randInt(90, 150)}/${randInt(60, 95)}`,
        vitalsHR: randInt(60, 130),
        vitalsRR: randInt(14, 28),
        vitalsSpO2: randInt(90, 99),
        vitalsTemp: 36.5 + Math.random() * 2.5,
        status,
        modeOfArrival: pickRandom(['walk-in', 'ambulance', 'private-vehicle']),
        broughtBy: pickRandom(['self', 'family', 'paramedic']),
        createdBy: DEMO_MARKER,
        createdAt,
      },
    });

    // MLC for some red/yellow cases
    if (isMlc && (triage === 'red' || triage === 'yellow')) {
      await prisma.mlcCase.create({
        data: {
          emergencyId: emer.id,
          mlcNo: `MLC-DEMO-${String(900 + i).padStart(3, '0')}`,
          caseType: pickRandom(['accident', 'assault', 'poison']),
          patientConsent: true,
          firstExaminationDone: true,
          injuries: 'Multiple abrasions, no obvious fracture',
          photographsTaken: false,
          status: pickRandom(['documented', 'examination-done', 'samples-collected']),
          createdBy: DEMO_MARKER,
        },
      });
    }
  }

  // 1 LAMA + 1 DAMA today
  const someErForLama = await prisma.emergency.findFirst({ where: { createdBy: DEMO_MARKER, mlcCase: null } });
  if (someErForLama) {
    await prisma.lamaRecord.create({
      data: {
        emergencyId: someErForLama.id,
        lamaTime: hoursAgo(2),
        doctorAdvice: 'Patient advised continued admission for observation; risks of leaving against medical advice explained in detail.',
        riskExplained: true,
        reasonForLama: 'Family decision — seeking second opinion',
        createdBy: DEMO_MARKER,
      },
    });
  }
  const someErForDama = await prisma.emergency.findFirst({ where: { createdBy: DEMO_MARKER, mlcCase: null, NOT: { lamaRecord: { isNot: null } } } });
  if (someErForDama) {
    await prisma.damaRecord.create({
      data: {
        emergencyId: someErForDama.id,
        dischargeTime: hoursAgo(3),
        doctorRecommendation: 'Recommended continued IV antibiotics and inpatient observation for 48h.',
        patientDeclinesAdvice: true,
        followUpAdvice: 'Return immediately if fever > 102°F or any breathing difficulty.',
        createdBy: DEMO_MARKER,
      },
    });
  }

  console.log(`   …${N} ER cases + MLC/LAMA/DAMA records.\n`);
}

// ────────────────────────────────────────────────────────────────────────────
// PRESCRIPTIONS (OPD) + INVESTIGATIONS
// ────────────────────────────────────────────────────────────────────────────

// Clinical result profiles — make seeded InvestigationResult rows look like
// real reports pulled from a lab/radiology feed. Keyed by the test
// description used in the Lab / Radiology catalogs.
const LAB_RESULT_PROFILES: Record<
  string,
  { result: string; unit: string; ref: string; critical: boolean }
> = {
  CBC: { result: 'Haemoglobin 9.1 (Low); TLC 13,400 (High); Platelets 1.42 L', unit: 'g/dL', ref: 'Hb 13.0 - 17.0', critical: true },
  LFT: { result: 'SGPT (ALT) 78; SGOT (AST) 65; Bilirubin 1.4', unit: 'U/L', ref: 'ALT 7 - 56', critical: false },
  KFT: { result: 'Creatinine 2.4; Urea 68; eGFR 29', unit: 'mg/dL', ref: 'Creatinine 0.7 - 1.3', critical: true },
  'Lipid profile': { result: 'LDL 168; Total Chol 244; Triglycerides 210', unit: 'mg/dL', ref: 'LDL < 100', critical: false },
  HbA1c: { result: '8.9', unit: '%', ref: '4.0 - 5.6', critical: false },
  TFT: { result: 'TSH 6.8; T3 0.9; T4 6.1', unit: 'mIU/L', ref: 'TSH 0.4 - 4.0', critical: false },
  'Troponin I': { result: '0.92', unit: 'ng/mL', ref: '< 0.04', critical: true },
  CRP: { result: '48', unit: 'mg/L', ref: '< 5', critical: false },
  'D-dimer': { result: '1.8', unit: 'µg/mL FEU', ref: '< 0.5', critical: true },
  'Urine routine': { result: 'Pus cells 12-15 /HPF; Albumin 1+; Nitrite positive', unit: '/HPF', ref: 'Pus cells 0 - 5 /HPF', critical: false },
};

const RADIO_RESULT_PROFILES: Record<
  string,
  { findings: string; impression: string; critical: boolean }
> = {
  'Chest X-ray PA': { findings: 'Patchy heterogeneous opacity in the right lower zone with air bronchograms. Cardiac silhouette normal. No pleural effusion or pneumothorax.', impression: 'Right lower-zone consolidation — likely pneumonia.', critical: false },
  'CT brain plain': { findings: 'No acute intracranial haemorrhage, infarct or mass effect. Age-appropriate involutional changes.', impression: 'No acute intracranial abnormality.', critical: false },
  'CT abdomen contrast': { findings: 'Dilated, fluid-filled appendix (11 mm) with peri-appendiceal fat stranding and a small appendicolith.', impression: 'Acute appendicitis.', critical: true },
  'MRI lumbar spine': { findings: 'L4-L5 posterocentral disc protrusion indenting the thecal sac with mild central canal narrowing.', impression: 'L4-L5 disc protrusion with mild canal stenosis.', critical: false },
  'USG abdomen': { findings: 'Multiple mobile echogenic calculi in the gall-bladder lumen, largest 9 mm. Wall not thickened. CBD normal.', impression: 'Cholelithiasis. No features of acute cholecystitis.', critical: false },
  ECG: { findings: 'ST-segment elevation in leads II, III and aVF with reciprocal ST depression in I and aVL.', impression: 'Acute inferior-wall ST-elevation MI — cardiology notified.', critical: true },
  '2D Echo': { findings: 'LV ejection fraction 38%. Regional wall-motion abnormality in the inferior wall. No pericardial effusion.', impression: 'Moderate LV systolic dysfunction (EF 38%).', critical: false },
  TMT: { findings: 'Test terminated at stage III for chest pain with 1.5 mm horizontal ST depression.', impression: 'Positive treadmill test for inducible ischaemia.', critical: true },
};

// Demo report PDFs — generated by scripts/generate-demo-reports.ts, served
// by Angular from public/demo-reports/. Stands in for the third-party feed.
const DEMO_LAB_REPORT_URL = '/demo-reports/lab-cbc-sample.pdf';
const DEMO_RADIO_REPORT_URL = '/demo-reports/radiology-cxr-sample.pdf';

async function seedOpdPrescriptionsAndInvestigations(
  patients: Array<{ prn: number; name: string }>,
  doctorIds: Record<string, number>,
): Promise<void> {
  console.log('💊 Seeding OPD prescriptions + investigations…');

  // Use existing Lab and Radiology test rows if any; else create a few — batched.
  let labRows = await prisma.lab.findMany({ take: 10 });
  if (labRows.length === 0) {
    const labNames = ['CBC', 'LFT', 'KFT', 'Lipid profile', 'HbA1c', 'TFT', 'Troponin I', 'CRP', 'D-dimer', 'Urine routine'];
    await prisma.lab.createMany({ data: labNames.map((name) => ({ description: name, department: 'lab' })) });
    labRows = await prisma.lab.findMany({ take: 10 });
  }
  let radioRows = await prisma.radiology.findMany({ take: 10 });
  if (radioRows.length === 0) {
    const radioNames = ['Chest X-ray PA', 'CT brain plain', 'CT abdomen contrast', 'MRI lumbar spine', 'USG abdomen', 'ECG', '2D Echo', 'TMT'];
    await prisma.radiology.createMany({ data: radioNames.map((name) => ({ description: name, department: 'radiology' })) });
    radioRows = await prisma.radiology.findMany({ take: 10 });
  }

  const docNames = DOCTORS.map((d) => ({ username: d.username, name: d.name + ' (Demo)' }));

  // 40 prescriptions across last 30 days — batched: prescriptions first,
  // then tablets that reference them by prescriptionId (a String unique key).
  const prescRows: any[] = [];
  const tabletRows: any[] = [];
  for (let i = 0; i < 40; i++) {
    const p = pickRandom(patients);
    const doc = pickRandom(docNames);
    const dateBack = randInt(0, 29);
    const date = daysAgo(dateBack);
    const prescriptionId = `RX-DEMO-${String(900 + i).padStart(4, '0')}`;
    prescRows.push({
      prescriptionId,
      prescribedBy: doc.name,
      prescribedDate: ymd(date),
      prn: String(p.prn),
      patientName: p.name,
    });
    const medCount = randInt(1, 3);
    for (let m = 0; m < medCount; m++) {
      const med = pickRandom(COMMON_MEDS);
      tabletRows.push({
        genericName: med.generic,
        brandName: med.brand,
        frequency: med.freq,
        duration: '5 days',
        instructions: 'Take with food',
        quantity: 10,
        prescriptionId,
        route: med.route,
      });
    }
  }
  if (prescRows.length > 0) await prisma.prescription.createMany({ data: prescRows });
  if (tabletRows.length > 0) await prisma.tablet.createMany({ data: tabletRows });

  // 20 investigation orders — kept as sequential creates because the
  // implicit m2m relations need connect{} calls Prisma can't batch via
  // createMany. Results are collected and batch-inserted afterwards.
  const resultRows: any[] = [];
  let resultSeq = 1;
  for (let i = 0; i < 20; i++) {
    const p = pickRandom(patients);
    const docKey = pickRandom(Object.keys(doctorIds));
    const doctorId = doctorIds[docKey];
    const docName = DOCTORS.find((d) => d.username === docKey)?.name || 'Demo';
    const dateBack = randInt(0, 29);
    const date = daysAgo(dateBack);

    const labTests = Array.from({ length: randInt(1, 2) }, () => pickRandom(labRows));
    const radioTests = Array.from({ length: randInt(0, 1) }, () => pickRandom(radioRows));

    const order = await prisma.investigationOrder.create({
      data: {
        prn: String(p.prn),
        date: ymd(date),
        doctorId,
        doctorName: docName + ' (Demo)',
        labTests: { connect: labTests.map((t) => ({ id: t.id })) },
        radiologyTests: { connect: radioTests.map((t) => ({ id: t.id })) },
      },
    });

    // ~75% of orders come back as a finalised result — as if pulled from a
    // third-party lab/radiology feed. Lab results carry result/unit/range +
    // the lab PDF; radiology results carry findings/impression + the imaging
    // PDF. Falls back to a generic profile for any test not in the map.
    if (Math.random() < 0.75) {
      const isLab = labTests.length > 0;
      const testName = isLab
        ? labTests[0].description
        : (radioTests[0]?.description || 'Chest X-ray PA');
      const reportedAt = hoursAgo(randInt(2, 60));
      const baseRow = {
        orderId: order.id,
        prn: String(p.prn),
        testName,
        status: 'final',
        reportedAt,
        uploadedAt: reportedAt,
        uploadedBy: 'Lab/Radiology Feed (Demo)',
        webhookProvider: 'demo-lis-feed',
        hmisResultId: `DEMO-LIS-${String(resultSeq++).padStart(4, '0')}`,
      };
      if (isLab) {
        const profile = LAB_RESULT_PROFILES[testName] ?? {
          result: 'Within normal limits', unit: '', ref: 'Normal', critical: false,
        };
        resultRows.push({
          ...baseRow,
          department: 'lab',
          result: profile.result,
          unit: profile.unit || null,
          referenceRange: profile.ref,
          criticalFlag: profile.critical,
          reportUrl: DEMO_LAB_REPORT_URL,
        });
      } else {
        const profile = RADIO_RESULT_PROFILES[testName] ?? {
          findings: 'No significant abnormality detected.',
          impression: 'Normal study.',
          critical: false,
        };
        resultRows.push({
          ...baseRow,
          department: 'radiology',
          result: profile.impression,
          findings: profile.findings,
          impression: profile.impression,
          criticalFlag: profile.critical,
          reportUrl: DEMO_RADIO_REPORT_URL,
        });
      }
    }
  }
  if (resultRows.length > 0) {
    await prisma.investigationResult.createMany({ data: resultRows });
  }

  console.log(`   …40 OPD prescriptions, 20 investigation orders, ${resultRows.length} results.\n`);
}

// ────────────────────────────────────────────────────────────────────────────
// REVENUE ROLLUP
// ────────────────────────────────────────────────────────────────────────────
async function seedRevenue(deptIds: Record<string, number>, _doctorIds: Record<string, number>): Promise<void> {
  console.log('💰 Seeding revenue rollups…');
  const services = ['opd-consultation', 'investigation', 'ipd', 'ot', 'package'];
  const rows: any[] = [];
  for (let dayBack = 0; dayBack <= 30; dayBack++) {
    const date = ymd(daysAgo(dayBack));
    for (const deptName of DEPARTMENTS) {
      const deptId = deptIds[deptName];
      for (const service of services) {
        const amount = service === 'ipd' ? randInt(50000, 250000)
          : service === 'ot' ? randInt(80000, 400000)
          : service === 'investigation' ? randInt(5000, 60000)
          : service === 'package' ? randInt(15000, 100000)
          : randInt(2000, 25000);
        const count = service === 'opd-consultation' ? randInt(2, 20) : randInt(1, 8);
        rows.push({
          date,
          departmentId: deptId,
          departmentName: deptName,
          serviceType: service,
          appointmentCount: count,
          totalAmount: amount,
        });
      }
    }
  }
  // Batch in chunks of 300, skipDuplicates handles the @@unique constraint.
  for (let i = 0; i < rows.length; i += 300) {
    await prisma.revenueRollup.createMany({
      data: rows.slice(i, i + 300),
      skipDuplicates: true,
    });
  }
  console.log(`   …${rows.length} revenue rollup rows.\n`);
}

// ────────────────────────────────────────────────────────────────────────────
// STAFF SHIFTS — for nurses today (drives ratios + on-duty counts)
// ────────────────────────────────────────────────────────────────────────────
async function seedShifts(userIds: Record<string, number>, wardIds: string[]): Promise<void> {
  console.log('📋 Seeding staff shifts…');

  // Ensure baseline ShiftDefinition rows exist.
  const shifts = await prisma.shiftDefinition.findMany();
  let dayShift = shifts.find((s) => s.code === 'M' || s.name.toLowerCase().includes('morning'));
  let eveningShift = shifts.find((s) => s.code === 'E' || s.name.toLowerCase().includes('evening'));
  if (!dayShift) {
    dayShift = await prisma.shiftDefinition.create({
      data: { name: 'Morning', code: 'M', startTime: '07:00', endTime: '15:00', sequence: 1 },
    });
  }
  if (!eveningShift) {
    eveningShift = await prisma.shiftDefinition.create({
      data: { name: 'Evening', code: 'E', startTime: '15:00', endTime: '23:00', sequence: 2 },
    });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const nurseUsers = [
    'nurse.b1.demo',
    'nurse.b1b.demo',
    'nurse.b2.demo',
    'nurse.b2b.demo',
    'nurse.icu.demo',
  ];
  const nurseToWard: Record<string, number> = {
    'nurse.b1.demo': 0,
    'nurse.b1b.demo': 0,
    'nurse.b2.demo': 1,
    'nurse.b2b.demo': 1,
    'nurse.icu.demo': 2,
  };

  let assigned = 0;
  for (const u of nurseUsers) {
    const userId = userIds[u];
    if (!userId) continue;
    const wardId = wardIds[nurseToWard[u]] || wardIds[0];
    try {
      await prisma.staffShiftAssignment.create({
        data: {
          userId,
          shiftId: dayShift.id,
          wardId,
          date: today,
          status: Math.random() > 0.2 ? 'ACKNOWLEDGED' : 'SCHEDULED',
          createdBy: DEMO_MARKER,
        },
      });
      assigned++;
    } catch {
      // dup unique key
    }
  }

  // 1 no-show
  try {
    const someNurse = userIds['nurse.b2b.demo'];
    if (someNurse) {
      await prisma.staffShiftAssignment.update({
        where: { userId_date_shiftId: { userId: someNurse, date: today, shiftId: eveningShift.id } },
        data: { status: 'NO_SHOW' },
      });
    }
  } catch {
    // no-op if it doesn't exist yet
    try {
      const someNurse = userIds['nurse.b2b.demo'];
      if (someNurse) {
        await prisma.staffShiftAssignment.create({
          data: {
            userId: someNurse,
            shiftId: eveningShift.id,
            wardId: wardIds[1],
            date: today,
            status: 'NO_SHOW',
            createdBy: DEMO_MARKER,
          },
        });
        assigned++;
      }
    } catch {
      // ignore
    }
  }

  console.log(`   …${assigned} shift assignments.\n`);
}

// ────────────────────────────────────────────────────────────────────────────
// CALLBACKS + HMIS DEAD-LETTERS
// ────────────────────────────────────────────────────────────────────────────
async function seedSupportingMisc(): Promise<void> {
  console.log('📞 Seeding callbacks, HMIS dead-letters…');
  for (let i = 0; i < 5; i++) {
    await prisma.callbackRequest.create({
      data: {
        name: `Demo Caller ${i + 1}`,
        mobile: `98${String(randInt(10000000, 99999999))}`,
        pageName: pickRandom(['Home', 'Departments', 'Doctors', 'Contact']),
        status: 'pending',
      },
    });
  }
  // 2 dead letters
  for (let i = 0; i < 2; i++) {
    const seedAudit = await prisma.hmisAuditLog.create({
      data: {
        direction: 'push',
        module: pickRandom(['opd', 'ipd', 'lab']),
        action: 'create',
        payload: '{"demo":true}',
        status: 'dead',
        retryCount: 3,
        quarantinedAt: hoursAgo(randInt(2, 24)),
      },
    });
    await prisma.hmisDeadLetter.create({
      data: {
        originalAuditLogId: seedAudit.id,
        module: seedAudit.module,
        action: seedAudit.action,
        direction: seedAudit.direction,
        payload: seedAudit.payload,
        errorDetail: 'HMIS endpoint returned 500 after 3 retries',
        retryCount: 3,
        status: 'QUARANTINED',
        resolvedBy: DEMO_MARKER, // marker for cleanup
      },
    });
  }
  console.log('   …done.\n');
}

// ────────────────────────────────────────────────────────────────────────────
// TREATMENT DASHBOARD — ACUITY SHOWCASE (Phase 9.13)
//
// Four hand-crafted patients so the watchboard demos the full deterioration
// story instead of an all-green board:
//   • ICU crashing      — NEWS2 climbs 1 → 18 over 6 readings (HIGH, red)
//   • Ward deteriorating — NEWS2 climbs 0 → 6 (MEDIUM) + "rising 3×" streak
//   • WATCH             — single red parameter (bradycardia), low total
//   • Stable            — normal vitals throughout (green, for contrast)
// Each vitals reading also gets a matching PatientAcuitySnapshot so the
// trend sparkline + rising-streak flag render without waiting for the cron.
// ────────────────────────────────────────────────────────────────────────────

interface ShowcaseReading {
  hAgo: number;
  // raw stream columns
  hr: number; sbp: number; dbp: number; rr: number; spo2: number; temp: number;
  gcs?: number;            // ICU only
  vent?: string | null;    // ICU only — presence ⇒ on supplemental O2
  acvpu?: 'A' | 'C' | 'V' | 'P' | 'U'; // IPD only
  onO2?: boolean;          // IPD only
}

async function makeShowcasePatient(opts: {
  prn: number;
  name: string;
  age: string;
  gender: string;
  isIcu: boolean;
  doctor: string;
  department: string;
  diagnosis: string;
  bed: { id: string; wardId: string } | null;
  admSuffix: number;
  readings: ShowcaseReading[]; // oldest → newest
  monitoringFrequency: string; // Phase 9.13 — doctor-ordered vitals frequency
  // Phase 9.14 — optional insulin-infusion chart rows.
  insulinReadings?: Array<{ hAgo: number; glucose: number; order: string; doctor: string; nurse: string; remarks?: string }>;
}): Promise<string> {
  await prisma.patientDetails.upsert({
    where: { prn: opts.prn },
    create: { prn: opts.prn, name: opts.name, age: opts.age, gender: opts.gender },
    update: { name: opts.name, age: opts.age, gender: opts.gender },
  });

  const admission = await prisma.ipdAdmission.create({
    data: {
      admissionNo: `ADM-DEMO-AC${String(opts.admSuffix).padStart(3, '0')}`,
      prn: String(opts.prn),
      admissionDate: daysAgo(opts.isIcu ? 3 : 2),
      admissionTime: formatTime12h(randInt(8, 18), 0),
      admissionType: 'emergency',
      sourceModule: 'emergency',
      admittingDoctor: opts.doctor,
      department: opts.department,
      wardId: opts.bed?.wardId ?? null,
      bedId: opts.bed?.id ?? null,
      roomType: opts.isIcu ? 'ICU' : 'general',
      diagnosis: opts.diagnosis,
      status: 'admitted',
      icuAdmittedAt: opts.isIcu ? hoursAgo(opts.readings[0].hAgo + 2) : null,
      // Phase 9.13 — doctor-ordered vitals monitoring frequency.
      vitalsMonitoringFrequency: opts.monitoringFrequency,
      vitalsMonitoringSetBy: opts.doctor,
      vitalsMonitoringSetAt: hoursAgo(opts.readings[0].hAgo + 1),
      createdBy: DEMO_MARKER,
      updatedBy: DEMO_MARKER,
    },
  });
  if (opts.bed) {
    await prisma.ipdBed.update({ where: { id: opts.bed.id }, data: { status: 'occupied' } });
  }

  // Build vitals rows + the matching NEWS2 snapshots.
  const snapshotRows: any[] = [];
  let prevScore: number | null = null;
  let prevPrevScore: number | null = null;

  for (const r of opts.readings) {
    const recordedAt = hoursAgo(r.hAgo);
    const news2 = computeNews2(
      opts.isIcu
        ? {
            respirationRate: r.rr, spo2: r.spo2, onOxygen: !!r.vent,
            temperatureC: r.temp, systolicBp: r.sbp, pulse: r.hr,
            consciousness: gcsToAcvpu(r.gcs ?? 15),
          }
        : {
            respirationRate: r.rr, spo2: r.spo2, onOxygen: !!r.onO2,
            temperatureC: r.temp, systolicBp: r.sbp, pulse: r.hr,
            consciousness: r.acvpu ?? 'A',
          },
    );

    if (opts.isIcu) {
      await prisma.icuVitalsReading.create({
        data: {
          admissionId: admission.id, recordedAt, intervalMinutes: 60,
          hr: r.hr, sbp: r.sbp, dbp: r.dbp, rr: r.rr, spo2: r.spo2,
          temp: r.temp, gcs: r.gcs ?? null, ventilatorMode: r.vent ?? null,
          recordedBy: DEMO_MARKER,
        },
      });
    } else {
      await prisma.ipdVitalsReading.create({
        data: {
          admissionId: admission.id, recordedAt,
          shift: r.hAgo > 16 ? 'N' : r.hAgo > 8 ? 'E' : 'M',
          temperatureC: r.temp, pulse: r.hr, respiration: r.rr,
          bpSystolic: r.sbp, bpDiastolic: r.dbp, spo2: r.spo2,
          consciousnessAcvpu: r.acvpu ?? 'A',
          onSupplementalOxygen: !!r.onO2,
          recordedBy: DEMO_MARKER,
        },
      });
    }

    const trend = prevScore == null
      ? 'stable'
      : news2.score > prevScore ? 'worsening'
      : news2.score < prevScore ? 'improving' : 'stable';
    const risingStreak =
      prevScore != null && prevPrevScore != null &&
      news2.score > prevScore && prevScore > prevPrevScore;

    snapshotRows.push({
      admissionId: admission.id,
      source: opts.isIcu ? 'ICU' : 'IPD',
      ewsScore: news2.score,
      ewsBand: news2.band,
      componentScores: JSON.stringify(news2.components),
      trend,
      risingStreak,
      vitalsRecordedAt: recordedAt,
      computedAt: recordedAt,
    });
    prevPrevScore = prevScore;
    prevScore = news2.score;
  }

  await prisma.patientAcuitySnapshot.createMany({ data: snapshotRows });

  // Phase 9.14 — insulin infusion chart rows (incl. critical glucose so the
  // Treatment Dashboard glucose chip lights up).
  if (opts.insulinReadings?.length) {
    await prisma.ipdInsulinInfusion.createMany({
      data: opts.insulinReadings.map((r) => ({
        admissionId: admission.id,
        recordedAt: hoursAgo(r.hAgo),
        bloodGlucoseMgDl: r.glucose,
        insulinOrder: r.order,
        doctorName: r.doctor,
        nurseName: r.nurse,
        remarks: r.remarks ?? null,
        recordedBy: DEMO_MARKER,
      })),
    });
  }

  return admission.id;
}

async function seedAcuityShowcase(
  beds: Array<{ id: string; wardId: string; bedNumber: string; type: string }>,
): Promise<void> {
  console.log('🩺 Seeding Treatment Dashboard acuity showcase…');

  // Free beds not taken by the main admission loop; fall back to null.
  const occupied = await prisma.ipdBed.findMany({
    where: { status: 'occupied' }, select: { id: true },
  });
  const taken = new Set(occupied.map((b) => b.id));
  const free = beds.filter((b) => !taken.has(b.id));
  const grab = (): { id: string; wardId: string } | null => {
    const b = free.shift();
    return b ? { id: b.id, wardId: b.wardId } : null;
  };

  // 1 — ICU crashing. NEWS2 1 → 18.
  const icuId = await makeShowcasePatient({
    prn: 970001, name: 'Showcase — Critical ICU', age: '64', gender: 'M',
    isIcu: true, doctor: 'Demo ICU Consultant', department: 'Critical Care',
    diagnosis: 'Septic shock, multi-organ involvement', bed: grab(), admSuffix: 1,
    monitoringFrequency: '1h', // crashing ICU patient — hourly order
    readings: [
      { hAgo: 6, hr: 95,  sbp: 120, dbp: 78, rr: 18, spo2: 97, temp: 37.1, gcs: 15 },
      { hAgo: 5, hr: 105, sbp: 110, dbp: 70, rr: 20, spo2: 95, temp: 37.6, gcs: 15 },
      { hAgo: 4, hr: 115, sbp: 100, dbp: 65, rr: 23, spo2: 93, temp: 38.0, gcs: 14 },
      { hAgo: 3, hr: 122, sbp: 95,  dbp: 60, rr: 25, spo2: 92, temp: 38.3, gcs: 13, vent: 'HFNC' },
      { hAgo: 2, hr: 128, sbp: 90,  dbp: 58, rr: 27, spo2: 90, temp: 38.6, gcs: 12, vent: 'NIV' },
      { hAgo: 1, hr: 132, sbp: 85,  dbp: 55, rr: 28, spo2: 89, temp: 38.8, gcs: 10, vent: 'NIV' },
    ],
    // Stress hyperglycaemia on an insulin infusion — climbing, several critical.
    insulinReadings: [
      { hAgo: 6, glucose: 210, order: 'H. Actrapid 2 ml/hr on flow', doctor: 'Dr. Sandeep', nurse: 'Sr. Lakshmi' },
      { hAgo: 5, glucose: 248, order: 'H. Actrapid 2 ml/hr on flow', doctor: 'Dr. Sandeep', nurse: 'Sr. Lakshmi' },
      { hAgo: 4, glucose: 286, order: 'H. Actrapid 3 ml/hr on flow', doctor: 'Dr. Sandeep', nurse: 'Sr. Lakshmi' },
      { hAgo: 3, glucose: 312, order: 'H. Actrapid 4 ml/hr on flow', doctor: 'Dr. Sai',     nurse: 'Sr. Lakshmi' },
      { hAgo: 2, glucose: 489, order: 'H. Actrapid 6 ml/hr on flow', doctor: 'Dr. Sai',     nurse: 'Sr. Lakshmi', remarks: 'Informed consultant' },
      { hAgo: 1, glucose: 345, order: 'H. Actrapid 4 ml/hr on flow', doctor: 'Dr. Sai',     nurse: 'Sr. Lakshmi' },
    ],
  });

  // A critical lab result on the ICU patient → 🩸 chip on the watchboard.
  const labOrder = await prisma.investigationOrder.create({
    data: {
      prn: '970001', date: ymd(new Date()), doctorId: 1,
      doctorName: 'Demo ICU Consultant', remarks: 'STAT — sepsis workup',
    },
  });
  await prisma.investigationResult.create({
    data: {
      orderId: labOrder.id, prn: '970001', testName: 'Serum Lactate',
      department: 'lab', result: '6.2', unit: 'mmol/L', referenceRange: '0.5-2.2',
      criticalFlag: true, status: 'final', reportedAt: hoursAgo(2),
      uploadedBy: DEMO_MARKER, uploadedAt: hoursAgo(2),
    },
  });

  // 2 — Ward patient deteriorating. NEWS2 0 → 6, rising-streak triggers.
  await makeShowcasePatient({
    prn: 970002, name: 'Showcase — Deteriorating Ward', age: '57', gender: 'F',
    isIcu: false, doctor: 'Demo Physician', department: 'General Medicine',
    diagnosis: 'Community-acquired pneumonia', bed: grab(), admSuffix: 2,
    monitoringFrequency: '2h', // deteriorating — frequency tightened to 2-hourly
    readings: [
      { hAgo: 10, hr: 80,  sbp: 126, dbp: 80, rr: 16, spo2: 98, temp: 36.8, acvpu: 'A' },
      { hAgo: 8,  hr: 92,  sbp: 118, dbp: 76, rr: 18, spo2: 96, temp: 37.0, acvpu: 'A' },
      { hAgo: 6,  hr: 98,  sbp: 110, dbp: 72, rr: 19, spo2: 95, temp: 37.5, acvpu: 'A' },
      { hAgo: 4,  hr: 103, sbp: 108, dbp: 70, rr: 20, spo2: 94, temp: 38.1, acvpu: 'A' },
      { hAgo: 2,  hr: 106, sbp: 106, dbp: 68, rr: 21, spo2: 94, temp: 37.9, acvpu: 'A' },
      { hAgo: 1,  hr: 109, sbp: 104, dbp: 66, rr: 22, spo2: 93, temp: 37.8, acvpu: 'A' },
    ],
    // Sliding-scale insulin; one critical reading.
    insulinReadings: [
      { hAgo: 8, glucose: 168, order: 'Inj Actrapid s/c — sliding scale', doctor: 'Dr. Manasa', nurse: 'Sr. Roshni' },
      { hAgo: 5, glucose: 204, order: 'Inj Actrapid 6 units s/c', doctor: 'Dr. Manasa', nurse: 'Sr. Roshni' },
      { hAgo: 2, glucose: 268, order: 'Inj Actrapid 8 units s/c', doctor: 'Dr. Manasa', nurse: 'Sr. Roshni' },
    ],
  });

  // 3 — WATCH: single red parameter (bradycardia HR 39), low total.
  await makeShowcasePatient({
    prn: 970003, name: 'Showcase — Single Red Param', age: '71', gender: 'M',
    isIcu: false, doctor: 'Demo Physician', department: 'Cardiology',
    diagnosis: 'Complete heart block for pacing', bed: grab(), admSuffix: 3,
    monitoringFrequency: '4h',
    readings: [
      { hAgo: 5, hr: 58, sbp: 124, dbp: 78, rr: 18, spo2: 97, temp: 36.9, acvpu: 'A' },
      { hAgo: 1, hr: 39, sbp: 122, dbp: 76, rr: 19, spo2: 98, temp: 37.0, acvpu: 'A' },
    ],
  });

  // 4 — Stable, all-normal vitals (green, for contrast).
  await makeShowcasePatient({
    prn: 970004, name: 'Showcase — Stable Recovery', age: '44', gender: 'F',
    isIcu: false, doctor: 'Demo Physician', department: 'General Surgery',
    diagnosis: 'Post-op day 2, appendicectomy', bed: grab(), admSuffix: 4,
    monitoringFrequency: '8h', // stable recovery — relaxed to 8-hourly
    readings: [
      { hAgo: 6, hr: 74, sbp: 120, dbp: 78, rr: 16, spo2: 98, temp: 36.8, acvpu: 'A' },
      { hAgo: 3, hr: 72, sbp: 118, dbp: 76, rr: 15, spo2: 99, temp: 36.9, acvpu: 'A' },
      { hAgo: 1, hr: 76, sbp: 122, dbp: 80, rr: 16, spo2: 98, temp: 37.0, acvpu: 'A' },
    ],
  });

  console.log(`   → acuity showcase: 4 patients seeded (ICU crash ${icuId.slice(0, 8)}…)`);
}

// ────────────────────────────────────────────────────────────────────────────
// DISCHARGED PATIENTS (Phase 9.15 — IPD overview "Discharges" tab)
// Real status='discharged' admissions with signed/draft discharge summaries,
// so the Discharges list + print + export have data. Beds are left free
// (the patient has gone home).
// ────────────────────────────────────────────────────────────────────────────
async function seedDischarges(
  patients: Array<{ prn: number; name: string; age: number; gender: 'M' | 'F' }>,
  wards: Array<{ id: string; code: string; name: string }>,
  doctorNames: string[],
): Promise<void> {
  console.log('🏠 Seeding discharged patients…');
  const adults = patients.filter((p) => p.age > 12);
  const N = 12;
  for (let i = 0; i < N; i++) {
    const p = adults[(i + 5) % adults.length];
    const ward = pickRandom(wards);
    const admittedDaysAgo = randInt(8, 25);
    const dischargedDaysAgo = randInt(1, admittedDaysAgo - 1);
    const doctorName = pickRandom(doctorNames);
    // ~1 in 4 left as an unsigned draft so the summary-status pill varies.
    const summaryStatus = i % 4 === 0 ? 'DRAFTED' : 'SIGNED';

    const admission = await prisma.ipdAdmission.create({
      data: {
        admissionNo: `ADM-DEMO-DC${String(i + 1).padStart(3, '0')}`,
        prn: String(p.prn),
        admissionDate: daysAgo(admittedDaysAgo),
        admissionTime: formatTime12h(randInt(8, 20), pickRandom([0, 30])),
        admissionType: pickRandom(['elective', 'emergency']),
        sourceModule: pickRandom(['opd', 'emergency', 'direct']),
        admittingDoctor: doctorName,
        department: pickRandom(DEPARTMENTS),
        wardId: ward.id,
        bedId: null, // bed freed on discharge
        roomType: pickRandom(['general', 'semi-private', 'private']),
        diagnosis: pickRandom(DIAGNOSES),
        status: 'discharged',
        createdBy: DEMO_MARKER,
        updatedBy: DEMO_MARKER,
      },
    });

    await prisma.ipdDischarge.create({
      data: {
        admissionId: admission.id,
        dischargeDate: daysAgo(dischargedDaysAgo),
        dischargeTime: formatTime12h(randInt(9, 18), pickRandom([0, 30])),
        dischargeType: 'regular',
        finalDiagnosis: admission.diagnosis,
        // Must match the discharge form's conditionOptions dropdown values.
        conditionAtDischarge: pickRandom(['Stable', 'Improved', 'Unchanged']),
        dischargeSummary: 'Patient responded well to treatment and is discharged in a stable condition with advice and follow-up.',
        medications: '[]',
        summaryStatus,
        clinicianSignedBy: summaryStatus === 'SIGNED' ? doctorName : null,
        clinicianSignedAt: summaryStatus === 'SIGNED' ? daysAgo(dischargedDaysAgo) : null,
        createdBy: DEMO_MARKER,
      },
    });
  }
  console.log(`   …${N} discharged patients seeded.`);
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('\n🌱 Dashboard demo seed starting...\n');
  checkSafety();

  const url = process.env.DATABASE_URL || '(unset)';
  console.log(`Target DB: ${url.replace(/:[^:@]+@/, ':***@')}`);
  console.log('Will delete prior DEMO_SEED rows then re-create. Ctrl+C to abort.\n');
  await pause(3000);

  await deleteExistingDemoData();
  const deptIds = await seedDepartments();
  const userIds = await seedUsers();
  const doctorIds = await seedDoctors(userIds, deptIds);
  const doctorDeptMap: Record<string, string> = {};
  for (const d of DOCTORS) doctorDeptMap[d.username] = d.department;

  const patients = await seedPatients();
  const { wards, beds } = await seedWardsAndBeds();

  await seedAppointments(patients, doctorIds, doctorDeptMap);

  const doctorNames = DOCTORS.map((d) => d.name);
  const admissions = await seedAdmissions(patients, beds, doctorNames);
  await seedAcuityShowcase(beds);
  await seedDischarges(patients, wards, doctorNames);
  await seedNursingSupportingData(admissions);
  await seedOtSchedules(doctorIds, patients);
  await seedEmergency();
  await seedOpdPrescriptionsAndInvestigations(patients, doctorIds);
  await seedRevenue(deptIds, doctorIds);
  await seedShifts(userIds, wards.map((w) => w.id));
  await seedSupportingMisc();

  console.log('\n✅ Demo seed complete!');
  console.log('\nLog in with any of these (password: ' + DEMO_PASSWORD + '):');
  console.log('  mgr.demo            → Management dashboard');
  console.log('  fd.demo             → Front Desk dashboard');
  console.log('  dr.cardio.demo      → Doctor dashboard (Cardiac specialty)');
  console.log('  dr.ortho.demo       → Doctor dashboard (Surgical specialty)');
  console.log('  dr.peds.demo        → Doctor dashboard (Pediatric specialty)');
  console.log('  dr.obgyn.demo       → Doctor dashboard (OBGYN specialty)');
  console.log('  dr.er.demo          → Doctor dashboard (Emergency specialty)');
  console.log('  dr.med.demo         → Doctor dashboard (General)');
  console.log('  nurse.b1.demo       → Bedside Nurse dashboard (Block 1)');
  console.log('  nurse.b2.demo       → Bedside Nurse dashboard (Block 2)');
  console.log('  super.demo          → Nursing Superintendent dashboard');
  console.log('\nOr hit the direct routes /dashboard/management, /dashboard/frontdesk, etc.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
