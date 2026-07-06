import { Request, Response } from 'express';
import crypto from 'crypto';
import { PatientRepository } from './patient.repository';
import { PrismaClient } from '@prisma/client';
import { generatePRN, syncPatientToHmis } from './patient-helper';
import { stripAuditFields } from '../../middleware/audit-guard';
import { auditLog } from '../../service/app-audit';

const prisma = new PrismaClient();

// ─── Phase 1 — validation helpers ────────────────────────────────────────
// Phone, email, blood-group, dob sanity. Each returns null on success or
// an error message. Cheap to add — every later phase relies on patient
// records being well-formed.

const ALLOWED_BLOOD_GROUPS = [
  'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-',
];

const ALLOWED_GENDERS = ['male', 'female', 'other', 'prefer-not-to-say'];

const ALLOWED_COMM_CHANNELS = ['sms', 'whatsapp', 'call', 'email'];

const PHONE_REGEX = /^[+]?\d{8,15}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validatePatientPayload(body: Record<string, unknown>): string | null {
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length < 2) {
    return 'name is required (min 2 characters)';
  }
  const phone = typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : '';
  if (!phone || !PHONE_REGEX.test(phone.replace(/[\s-]/g, ''))) {
    return 'phoneNumber is required and must be 8–15 digits';
  }
  if (body.email && typeof body.email === 'string' && body.email.trim().length > 0) {
    if (!EMAIL_REGEX.test(body.email.trim())) return 'email is not a valid format';
  }
  if (body.bloodGroup && typeof body.bloodGroup === 'string' && body.bloodGroup.trim().length > 0) {
    if (!ALLOWED_BLOOD_GROUPS.includes(body.bloodGroup.trim().toUpperCase())) {
      return `bloodGroup must be one of: ${ALLOWED_BLOOD_GROUPS.join(', ')}`;
    }
  }
  if (body.gender && typeof body.gender === 'string' && body.gender.trim().length > 0) {
    if (!ALLOWED_GENDERS.includes(body.gender.trim().toLowerCase())) {
      return `gender must be one of: ${ALLOWED_GENDERS.join(', ')}`;
    }
  }
  if (body.preferredCommChannel && typeof body.preferredCommChannel === 'string') {
    if (!ALLOWED_COMM_CHANNELS.includes(body.preferredCommChannel.trim().toLowerCase())) {
      return `preferredCommChannel must be one of: ${ALLOWED_COMM_CHANNELS.join(', ')}`;
    }
  }
  if (body.dob && typeof body.dob === 'string' && body.dob.trim().length > 0) {
    const d = new Date(body.dob);
    if (Number.isNaN(d.getTime())) return 'dob must be a valid date string';
    const now = new Date();
    if (d.getTime() > now.getTime()) return 'dob cannot be in the future';
    const yearsOld = (now.getTime() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (yearsOld > 130) return 'dob seems unrealistic (>130 years ago)';
  }
  return null;
}

// ABHA hash: never store the raw 14-digit ABHA number. Hash it for lookup.
function hashAbha(raw: string): { hash: string; last4: string } | null {
  const cleaned = raw.replace(/\D/g, '');
  if (cleaned.length < 4) return null;
  return {
    hash: crypto.createHash('sha256').update(cleaned).digest('hex'),
    last4: cleaned.slice(-4),
  };
}

export class PatientController {
  private patientRepository: PatientRepository;

  constructor() {
    this.patientRepository = new PatientRepository();
  }

  async createPatient(req: Request, res: Response): Promise<void> {
    try {
      // Phase 1 — validate the full extended payload before doing anything.
      const validationError = validatePatientPayload(req.body);
      if (validationError) {
        res.status(400).json({ message: validationError });
        return;
      }

      const {
        name,
        phoneNumber,
        email,
        prn: providedPrn,
        dob,
        age,
        gender,
        bloodGroup,
        address,
        city,
        state,
        country,
        pin,
        contactNo,
        patientType,
        foreignNational,
        chronicConditions,
        currentMedications,
        knownAllergies,
        nextOfKinName,
        nextOfKinRelation,
        nextOfKinPhone,
        preferredLanguage,
        preferredCommChannel,
        abhaId,
        source,
        consentVersionAccepted,
        consentSignatureId,
        allowDuplicatePhone,
      } = req.body;

      const mobileNo = String(phoneNumber).trim();

      // Phone-number deduplication — warn but allow. A duplicate phone blocks
      // creation with 409 unless the caller opts in via `allowDuplicatePhone`.
      // `mobileNo` is not a DB unique constraint, so forced creation succeeds.
      if (!allowDuplicatePhone) {
        const existingPatient = await this.patientRepository.getPatientByMobileNumber(mobileNo);
        if (existingPatient) {
          res.status(409).json({
            message: 'Patient with this phone number already exists',
            patient: existingPatient,
            duplicatePhone: true,
          });
          return;
        }
      }

      // Auto-generate PRN if not provided.
      const prn = providedPrn ?? (await generatePRN());

      // Hash ABHA ID if supplied — never store the raw 14-digit number.
      const abha = typeof abhaId === 'string' && abhaId.trim().length > 0 ? hashAbha(abhaId) : null;

      const createdBy = req.user?.username ?? null;
      const createdById = typeof req.user?.id === 'number' ? req.user.id : undefined;

      const patient = await this.patientRepository.createPatient({
        name: String(name).trim(),
        mobileNo,
        email: typeof email === 'string' ? email.trim() : undefined,
        prn,

        contactNo: contactNo?.toString().trim(),
        dob: typeof dob === 'string' ? dob.trim() : undefined,
        age: age !== undefined ? String(age) : undefined,
        gender: typeof gender === 'string' ? gender.trim().toLowerCase() : undefined,
        bloodGroup: typeof bloodGroup === 'string' ? bloodGroup.trim().toUpperCase() : undefined,
        address: typeof address === 'string' ? address.trim() : undefined,
        city: typeof city === 'string' ? city.trim() : undefined,
        state: typeof state === 'string' ? state.trim() : undefined,
        country: typeof country === 'string' ? country.trim() : undefined,
        pin: typeof pin === 'string' ? pin.trim() : undefined,
        patientType: typeof patientType === 'string' ? patientType.trim() : undefined,
        foreignNational: typeof foreignNational === 'boolean' ? foreignNational : undefined,

        chronicConditions: typeof chronicConditions === 'string' ? chronicConditions.trim() : undefined,
        currentMedications: typeof currentMedications === 'string' ? currentMedications.trim() : undefined,
        knownAllergies: typeof knownAllergies === 'string' ? knownAllergies.trim() : undefined,
        nextOfKinName: typeof nextOfKinName === 'string' ? nextOfKinName.trim() : undefined,
        nextOfKinRelation: typeof nextOfKinRelation === 'string' ? nextOfKinRelation.trim() : undefined,
        nextOfKinPhone: typeof nextOfKinPhone === 'string' ? nextOfKinPhone.trim() : undefined,
        preferredLanguage: typeof preferredLanguage === 'string' ? preferredLanguage.trim() : undefined,
        preferredCommChannel:
          typeof preferredCommChannel === 'string' ? preferredCommChannel.trim().toLowerCase() : undefined,
        abhaIdHash: abha?.hash,
        abhaIdLast4: abha?.last4,
        source: typeof source === 'string' ? source.trim() : 'admin',
        verified: true, // admin-side registration is pre-verified
        consentVersionAccepted:
          typeof consentVersionAccepted === 'string' ? consentVersionAccepted.trim() : undefined,
        consentAcceptedAt: consentVersionAccepted ? new Date() : undefined,
        consentSignatureId: typeof consentSignatureId === 'string' ? consentSignatureId.trim() : undefined,

        createdBy: createdBy ?? undefined,
        createdById,
      });

      // Audit (Phase 0 helper) — never blocks the request.
      await auditLog(req, {
        module: 'patient',
        action: 'CREATE',
        entityType: 'PatientDetails',
        entityId: patient.id,
        payload: {
          prn: patient.prn,
          source: patient.source,
          hasConsent: Boolean(patient.consentSignatureId),
        },
      });

      // Push to HMIS asynchronously (existing behaviour — non-blocking).
      try {
        await syncPatientToHmis({
          ...patient,
          dob,
          gender,
          bloodGroup,
          address,
        });
      } catch (hmisError) {
        console.error('HMIS sync failed (non-blocking):', hmisError);
      }

      res.status(201).json(patient);
    } catch (error) {
      console.error('createPatient failed:', error);
      res.status(500).json({ message: 'Error creating patient', error });
    }
  }

  async getPatient(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const patient = await this.patientRepository.getPatientById(Number(id));
      if (patient) {
        res.status(200).json(patient);
      } else {
        res.status(404).json({ message: 'Patient not found' });
      }
    } catch (error) {
      res.status(500).json({ message: 'Error fetching patient', error });
    }
  }

  /**
   * Phase 1 — Duplicate-check by phone. Returns 200 with the row if found,
   * 200 with `null` if not (so the frontend can proceed without a 404 noise
   * in the console).
   */
  async getPatientByPhone(req: Request, res: Response): Promise<void> {
    try {
      const phone = String(req.params.phone || '').trim();
      if (!phone) {
        res.status(400).json({ message: 'phone is required' });
        return;
      }
      const patient = await this.patientRepository.getPatientByMobileNumber(phone);
      res.status(200).json(patient ?? null);
    } catch (error) {
      console.error('getPatientByPhone failed:', error);
      res.status(500).json({ message: 'Error looking up patient by phone', error });
    }
  }

  async updatePatient(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { name, phoneNumber, email, prn } = req.body;
      const mobileNo = phoneNumber
      const updatedPatient = await this.patientRepository.updatePatient(Number(id), { name, mobileNo, email, prn });
      res.status(200).json(updatedPatient);
    } catch (error) {
      res.status(500).json({ message: 'Error updating patient', error });
    }
  }

  async deletePatient(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      await this.patientRepository.deletePatient(Number(id));
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: 'Error deleting patient', error });
    }
  }
  async getPatients(req: Request, res: Response): Promise<void> {
    try {
      const allPatients = await this.patientRepository.getAllPatients();
      // console.log(allPatients)
      res.status(200).send(allPatients);
    } catch (error) {
      res.status(500).json({ message: 'Error deleting patient', error });
    }
  }
  async getDetailsByPRN(req: Request, res: Response): Promise<void> {
    try {
      const { prnNumber } = req.body;
  
      if (!prnNumber) {
        res.status(400).json({ message: 'PNR number is required' });
        return;
      }
      // Some tables key prn as Int, others as String. A non-numeric PRN
      // (e.g. an alphanumeric case no.) would make Number(prnNumber) NaN and
      // Prisma rejects NaN for an Int field — so guard the Int-keyed queries.
      const prnStr = prnNumber.toString();
      const prnInt = Number(prnNumber);
      const hasIntPrn = Number.isInteger(prnInt);

      const appointments = hasIntPrn
        ? await prisma.appointment.findMany({ where: { prnNumber: prnInt } })
        : [];
      const serviceAppointments = await prisma.serviceAppointments.findMany({
        where: { pnrNumber: prnStr },
        include: { RadioService: true }
      });

      const services = await prisma.service.findMany({
        where: { pnrNumber: prnStr },
        include: { repeatedDates: true, package: true, RadioService: true }
      });
      const doctorNotes = hasIntPrn
        ? await prisma.doctorNote.findMany({
            where: { prn: prnInt },
            orderBy: { createdAt: 'desc' }
          })
        : [];
      const patientData = hasIntPrn
        ? await prisma.patientDetails.findUnique({ where: { prn: prnInt } })
        : null;

      const prescriptionData = await prisma.prescription.findMany({
        where: { prn: prnStr },
        include: {
          tablets: true,
        }
      });

      const historyData = hasIntPrn
        ? await prisma.historyNotes.findMany({
            where: { prn: prnInt },
            orderBy: { createdAt: 'desc' }
          })
        : [];
      const investigationOrders = await prisma.investigationOrder.findMany({
        where: { prn: prnNumber.toString() },
        include: {
          labTests: true,
          radiologyTests: true,
          packages: true
        },
        orderBy: { createdAt: 'desc' }
      });
  
      res.json({
        appointments: appointments,
        serviceAppointments: serviceAppointments,
        services: services,
        doctorNotes: doctorNotes,
        patientData: patientData,
        prescriptionData: prescriptionData,
        historyData: historyData,
        investigationOrders: investigationOrders
      });
  
    } catch (error) {
      console.error('Error fetching data by PRN:', error);
      res.status(500).json({ message: 'Internal server error', error });
    }
  };
async updatePatientByPRN(req: Request, res: Response):Promise<void>{

  
    try {
      const { prn } = req.params;
      const data = req.body;
  
      console.log(prn,'hi',data)
      const existing = await prisma.patientDetails.findUnique({
        where: { prn: Number(prn) },
      });
  
      if (!existing) {
         res.status(404).json({ message: 'Patient not found with this PRN' });
         return
      }
      const updated = await prisma.patientDetails.update({
        where: { prn: Number(prn) },
        data
      });
  
      res.json({ message: 'Patient updated', data: updated });
    } catch (error) {
      console.error('Error updating patient:', error);
      res.status(500).json({ message: 'Failed to update patient' });
    }
  };
}
export const createPatient = async (req: Request, res: Response) => {
  try {
    const patientData = req.body;

    // Check if PRN already exists
    const existingPatient = await prisma.patientDetails.findUnique({
      where: { prn: patientData.prn }
    });

    if (existingPatient) {
       res.status(400).json({ message: 'PRN already exists. Please use a unique PRN number.' });
       return
    }

    // Create new patient.
    // Sprint 4b.2 — stripAuditFields prophylactic: PatientDetails has no audit
    // columns today, but the body-spread pattern would silently leak the moment
    // createdBy / updatedBy are added. Strip defensively; zero behaviour change now.
    const newPatient = await prisma.patientDetails.create({
      data: {
        ...stripAuditFields(patientData),
        created_at: new Date()
      }
    });

    res.status(201).json({ message: 'Patient created successfully', data: newPatient });
  } catch (error) {
    console.error('Error creating patient:', error);
    res.status(500).json({ message: 'Internal Server Error', error });
  }
};