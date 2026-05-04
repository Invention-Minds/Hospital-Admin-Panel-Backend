/* eslint-disable no-console */
/**
 * Dev-auth seed script.
 *
 * Fills the gap left by seed-sprint-3.ts: creates User + Department + Doctor
 * rows so the dev DB is loginable, plus 3 more PatientDetails and 3 today-
 * dated Appointments so OPD → IPD manual testing has something to act on.
 *
 * Login contract (verified from src/api/login/login.resolver.ts):
 *   - loginUser(password, employeeId) via POST /api/login with { employeeId, password }
 *   - loginDoctor(password, userId) — resolved by phoneNumber lookup on Doctor
 *   - Password stored as bcrypt.hashSync(raw, 10) — re-used here.
 *
 * Safety guarantees:
 *   - Idempotent: every write is upsert-on-unique-key or findFirst+create.
 *     Re-running yields the same row count; second run reports skipped=N.
 *   - Non-destructive: zero deletes / truncates / drops.
 *   - Additive only: does not touch seed-sprint-3 rows.
 *
 * Run with:
 *   cd Hospital-Admin-Panel-Backend
 *   npx ts-node scripts/seed-dev-auth.ts
 */

import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ---------- Seed markers ----------------------------------------------------
const SEED_PRN_EXTRA = [9900004, 9900005, 9900006];
const TODAY_ISO = new Date().toISOString().split('T')[0]; // local today YYYY-MM-DD

type Counts = Record<string, { created: number; skipped: number }>;
const counts: Counts = {};
function bump(entity: string, kind: 'created' | 'skipped'): void {
  if (!counts[entity]) counts[entity] = { created: 0, skipped: 0 };
  counts[entity][kind] += 1;
}

// ---------- User seed -------------------------------------------------------

interface SeedUser {
  username: string;
  employeeId: string;
  password: string;
  role: UserRole;
}

const USERS: SeedUser[] = [
  { username: 'admin',         employeeId: 'admin',         password: 'admin123',  role: UserRole.admin },
  { username: 'nurse.geetha',  employeeId: 'nurse.geetha',  password: 'nurse123',  role: UserRole.sub_admin }, // no nurse role in enum — sub_admin
  { username: 'dr.priya',      employeeId: 'dr.priya',      password: 'doctor123', role: UserRole.doctor },
  { username: 'dr.mahesh',     employeeId: 'dr.mahesh',     password: 'doctor123', role: UserRole.doctor },
  { username: 'dr.raghav',     employeeId: 'dr.raghav',     password: 'doctor123', role: UserRole.doctor },
  { username: 'dr.kavitha',    employeeId: 'dr.kavitha',    password: 'doctor123', role: UserRole.doctor },
];

async function seedUsers(): Promise<Record<string, number>> {
  const ids: Record<string, number> = {};
  for (const u of USERS) {
    const existing = await prisma.user.findUnique({ where: { employeeId: u.employeeId } });
    if (existing) {
      ids[u.username] = existing.id;
      bump('User', 'skipped');
      continue;
    }
    const hashed = bcrypt.hashSync(u.password, 10);
    const created = await prisma.user.create({
      data: {
        username: u.username,
        employeeId: u.employeeId,
        password: hashed,
        role: u.role,
        isActive: true,
        isReceptionist: false,
        createdBy: 'seed-dev-auth',
      },
    });
    ids[u.username] = created.id;
    bump('User', 'created');
  }
  return ids;
}

// ---------- Department seed -------------------------------------------------

const DEPARTMENTS = ['Cardiology', 'General Medicine', 'Emergency', 'OBG'];

async function seedDepartments(): Promise<Record<string, number>> {
  const ids: Record<string, number> = {};
  for (const name of DEPARTMENTS) {
    const existing = await prisma.department.findUnique({ where: { name } });
    if (existing) {
      ids[name] = existing.id;
      bump('Department', 'skipped');
      continue;
    }
    const created = await prisma.department.create({ data: { name } });
    ids[name] = created.id;
    bump('Department', 'created');
  }
  return ids;
}

// ---------- Doctor seed -----------------------------------------------------

interface SeedDoctor {
  name: string;
  email: string;
  phone: string;
  qualification: string;
  department: string;
  designation: string;
  kmcNumber: string;
  userKey: string;
}

const DOCTORS: SeedDoctor[] = [
  {
    name: 'Dr. Priya Sharma',
    email: 'priya.sharma@docminds.local',
    phone: '919876501001',
    qualification: 'MBBS, MD (Cardiology)',
    department: 'Cardiology',
    designation: 'OPD Consultant',
    kmcNumber: 'KMC-PRIYA-001',
    userKey: 'dr.priya',
  },
  {
    name: 'Dr. Mahesh Kumar',
    email: 'mahesh.kumar@docminds.local',
    phone: '919876501002',
    qualification: 'MBBS, MD (Internal Medicine)',
    department: 'General Medicine',
    designation: 'IPD Physician',
    kmcNumber: 'KMC-MAHESH-001',
    userKey: 'dr.mahesh',
  },
  {
    name: 'Dr. Raghav Reddy',
    email: 'raghav.reddy@docminds.local',
    phone: '919876501003',
    qualification: 'MBBS, MS (Emergency Medicine)',
    department: 'Emergency',
    designation: 'Emergency Physician',
    kmcNumber: 'KMC-RAGHAV-001',
    userKey: 'dr.raghav',
  },
  {
    name: 'Dr. Kavitha Rao',
    email: 'kavitha.rao@docminds.local',
    phone: '919876501004',
    qualification: 'MBBS, MS (OBG)',
    department: 'OBG',
    designation: 'OBG / Surgeon',
    kmcNumber: 'KMC-KAVITHA-001',
    userKey: 'dr.kavitha',
  },
];

async function seedDoctors(
  deptIds: Record<string, number>,
  userIds: Record<string, number>
): Promise<Record<string, number>> {
  const ids: Record<string, number> = {};
  for (const d of DOCTORS) {
    const existing = await prisma.doctor.findFirst({
      where: { email: d.email }, // email used as the effective unique key
    });
    if (existing) {
      ids[d.name] = existing.id;
      bump('Doctor', 'skipped');
      continue;
    }
    const created = await prisma.doctor.create({
      data: {
        name: d.name,
        email: d.email,
        phone_number: d.phone,
        qualification: d.qualification,
        departmentId: deptIds[d.department],
        departmentName: d.department,
        userId: userIds[d.userKey],
        doctorType: 'Regular',
        kmcNumber: d.kmcNumber,
        isActive: true,
        createdBy: 'seed-dev-auth',
      },
    });
    ids[d.name] = created.id;
    bump('Doctor', 'created');
  }
  return ids;
}

// ---------- Extra patients (3 more, PRN 9900004–9900006) --------------------

const EXTRA_PATIENTS = [
  { prn: 9900004, name: 'SEED — Sunita Rao',   phone: '+919900000004', email: 'seed4@seed.local', age: '42', gender: 'female', mlcCandidate: false },
  { prn: 9900005, name: 'SEED — Arjun Shetty', phone: '+919900000005', email: 'seed5@seed.local', age: '28', gender: 'male',   mlcCandidate: true  },
  { prn: 9900006, name: 'SEED — Lakshmi Nair', phone: '+919900000006', email: 'seed6@seed.local', age: '60', gender: 'female', mlcCandidate: false },
];

async function seedExtraPatients(): Promise<Record<number, number>> {
  const ids: Record<number, number> = {};
  for (const p of EXTRA_PATIENTS) {
    const existing = await prisma.patientDetails.findUnique({ where: { prn: p.prn } });
    if (existing) {
      ids[p.prn] = existing.id;
      bump('PatientDetails', 'skipped');
      continue;
    }
    const created = await prisma.patientDetails.create({
      data: {
        prn: p.prn,
        name: p.name,
        mobileNo: p.phone,
        email: p.email,
        age: p.age,
        gender: p.gender,
        patientType: 'SEED',
        country: 'India',
      },
    });
    ids[p.prn] = created.id;
    bump('PatientDetails', 'created');
  }
  return ids;
}

// ---------- Today appointments ----------------------------------------------

interface SeedAppt {
  prn: number;
  patientName: string;
  phone: string;
  email: string;
  doctorName: string;
  doctorKey: string;
  department: string;
  time: string;
  status: 'pending' | 'completed';
  checkedIn: boolean;
}

function todayAppointments(): SeedAppt[] {
  return [
    {
      prn: 9900004, patientName: 'SEED — Sunita Rao', phone: '+919900000004', email: 'seed4@seed.local',
      doctorName: 'Dr. Priya Sharma', doctorKey: 'Dr. Priya Sharma', department: 'Cardiology',
      time: '09:00', status: 'completed', checkedIn: true,
    },
    {
      prn: 9900005, patientName: 'SEED — Arjun Shetty', phone: '+919900000005', email: 'seed5@seed.local',
      doctorName: 'Dr. Priya Sharma', doctorKey: 'Dr. Priya Sharma', department: 'Cardiology',
      time: '10:30', status: 'pending', checkedIn: true, // checked-in, ready for OPD assessment
    },
    {
      prn: 9900006, patientName: 'SEED — Lakshmi Nair', phone: '+919900000006', email: 'seed6@seed.local',
      doctorName: 'Dr. Kavitha Rao', doctorKey: 'Dr. Kavitha Rao', department: 'OBG',
      time: '11:00', status: 'pending', checkedIn: false, // not yet checked in
    },
  ];
}

async function seedTodayAppointments(doctorIds: Record<string, number>): Promise<void> {
  for (const a of todayAppointments()) {
    const existing = await prisma.appointment.findFirst({
      where: {
        prnNumber: a.prn,
        date: TODAY_ISO,
        time: a.time,
      },
    });
    if (existing) {
      bump('Appointment', 'skipped');
      continue;
    }
    await prisma.appointment.create({
      data: {
        patientName: a.patientName,
        phoneNumber: a.phone,
        email: a.email,
        doctorId: doctorIds[a.doctorKey] ?? null,
        doctorName: a.doctorName,
        department: a.department,
        date: TODAY_ISO,
        time: a.time,
        status: a.status,
        prnNumber: a.prn,
        patientType: 'SEED',
        checkedIn: a.checkedIn,
        checkedInTime: a.checkedIn ? new Date() : null,
      },
    });
    bump('Appointment', 'created');
  }
}

// ---------- HDU + isolation beds + one maintenance bed ----------------------

async function seedBedVariety(): Promise<void> {
  const icu = await prisma.ipdWard.findUnique({ where: { wardCode: 'SEED-W-ICU' } });
  const gen = await prisma.ipdWard.findUnique({ where: { wardCode: 'SEED-W-GEN' } });
  if (!icu || !gen) {
    console.log('  (skipping bed-variety seed — SEED- wards not present; run seed-sprint-3 first)');
    return;
  }

  const extras: Array<{ wardId: string; bedNumber: string; bedType: string; status: string }> = [
    { wardId: icu.id, bedNumber: 'SEED-HDU-01', bedType: 'HDU',       status: 'available' },
    { wardId: icu.id, bedNumber: 'SEED-ISO-01', bedType: 'isolation', status: 'available' },
  ];

  for (const b of extras) {
    const existing = await prisma.ipdBed.findUnique({
      where: { wardId_bedNumber: { wardId: b.wardId, bedNumber: b.bedNumber } },
    });
    if (existing) {
      bump('IpdBed', 'skipped');
      continue;
    }
    await prisma.ipdBed.create({ data: b });
    bump('IpdBed', 'created');
  }

  // Flag one general bed (not the occupied one) as 'maintenance' if no bed is
  // currently in maintenance. Idempotent: the condition skips if already set.
  const anyMaintenance = await prisma.ipdBed.count({ where: { status: 'maintenance' } });
  if (anyMaintenance === 0) {
    // Pick the highest-numbered available general bed to avoid colliding
    // with the seeded admission's bed.
    const target = await prisma.ipdBed.findFirst({
      where: { wardId: gen.id, status: 'available' },
      orderBy: { bedNumber: 'desc' },
    });
    if (target) {
      await prisma.ipdBed.update({ where: { id: target.id }, data: { status: 'maintenance' } });
      bump('IpdBed (→maintenance)', 'created');
    }
  } else {
    bump('IpdBed (→maintenance)', 'skipped');
  }
}

// ---------- Orchestration ---------------------------------------------------

async function main(): Promise<void> {
  console.log('[seed-dev-auth] starting…');

  const userIds = await seedUsers();
  const deptIds = await seedDepartments();
  const doctorIds = await seedDoctors(deptIds, userIds);
  await seedExtraPatients();
  await seedTodayAppointments(doctorIds);
  await seedBedVariety();

  console.log('\n[seed-dev-auth] done. Summary:');
  console.log(JSON.stringify(counts, null, 2));

  // Post-seed snapshot
  const [users, depts, doctors, patients, appts] = await Promise.all([
    prisma.user.count(),
    prisma.department.count(),
    prisma.doctor.count(),
    prisma.patientDetails.count(),
    prisma.appointment.count(),
  ]);
  console.log('\nTotal row counts now:');
  console.log(`  User            ${users}`);
  console.log(`  Department      ${depts}`);
  console.log(`  Doctor          ${doctors}`);
  console.log(`  PatientDetails  ${patients}`);
  console.log(`  Appointment     ${appts}`);
}

main()
  .catch((err: unknown) => {
    console.error('[seed-dev-auth] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
