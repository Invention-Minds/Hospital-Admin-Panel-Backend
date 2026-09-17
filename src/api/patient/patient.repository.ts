import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Phase 1 — Patient repository.
 *
 * Storage is `patientDetails` despite the legacy `Patient` model still existing
 * (the `Patient` row is kept for `Appointment.patientId` joins). Every new
 * field captured at registration lives on `PatientDetails`.
 */

export interface CreatePatientInput {
  name: string;
  mobileNo: string;
  email?: string;
  prn: number;

  // Phase 1 — extended fields. All optional.
  contactNo?: string;
  dob?: string;
  age?: string;
  gender?: string;
  bloodGroup?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  pin?: string;

  chronicConditions?: string;
  currentMedications?: string;
  knownAllergies?: string;
  nextOfKinName?: string;
  nextOfKinRelation?: string;
  nextOfKinPhone?: string;
  preferredLanguage?: string;
  preferredCommChannel?: string;
  abhaIdHash?: string;
  abhaIdLast4?: string;
  source?: string;
  verified?: boolean;
  consentVersionAccepted?: string;
  consentAcceptedAt?: Date;
  consentSignatureId?: string;

  patientType?: string;
  foreignNational?: boolean;

  // Audit attribution
  createdBy?: string;
  createdById?: number;
}

export interface UpdatePatientInput extends Partial<CreatePatientInput> {
  updatedBy?: string;
  updatedById?: number;
}

export class PatientRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async createPatient(data: CreatePatientInput) {
    const payload: Prisma.PatientDetailsCreateInput = {
      name: data.name,
      prn: data.prn,
      mobileNo: data.mobileNo,
      contactNo: data.contactNo,
      email: data.email,
      dob: data.dob,
      age: data.age,
      gender: data.gender,
      bloodGroup: data.bloodGroup,
      address: data.address,
      city: data.city,
      state: data.state,
      country: data.country,
      pin: data.pin,
      patientType: data.patientType,
      foreignNational: data.foreignNational,

      chronicConditions: data.chronicConditions,
      currentMedications: data.currentMedications,
      knownAllergies: data.knownAllergies,
      nextOfKinName: data.nextOfKinName,
      nextOfKinRelation: data.nextOfKinRelation,
      nextOfKinPhone: data.nextOfKinPhone,
      preferredLanguage: data.preferredLanguage,
      preferredCommChannel: data.preferredCommChannel,
      abhaIdHash: data.abhaIdHash,
      abhaIdLast4: data.abhaIdLast4,
      source: data.source ?? 'admin',
      verified: data.verified ?? true,
      consentVersionAccepted: data.consentVersionAccepted,
      consentAcceptedAt: data.consentAcceptedAt,
      consentSignatureId: data.consentSignatureId,

      createdBy: data.createdBy,
      createdById: data.createdById,
    };
    return this.prisma.patientDetails.create({ data: payload });
  }

  async getPatientById(id: number) {
    return this.prisma.patientDetails.findFirst({ where: { id } });
  }

  async getPatientByPrn(prn: number) {
    return this.prisma.patientDetails.findFirst({ where: { prn } });
  }

  async updatePatient(id: number, data: UpdatePatientInput) {
    const payload: Prisma.PatientDetailsUpdateInput = {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.mobileNo !== undefined && { mobileNo: data.mobileNo }),
      ...(data.contactNo !== undefined && { contactNo: data.contactNo }),
      ...(data.email !== undefined && { email: data.email }),
      ...(data.dob !== undefined && { dob: data.dob }),
      ...(data.age !== undefined && { age: data.age }),
      ...(data.gender !== undefined && { gender: data.gender }),
      ...(data.bloodGroup !== undefined && { bloodGroup: data.bloodGroup }),
      ...(data.address !== undefined && { address: data.address }),
      ...(data.city !== undefined && { city: data.city }),
      ...(data.state !== undefined && { state: data.state }),
      ...(data.country !== undefined && { country: data.country }),
      ...(data.pin !== undefined && { pin: data.pin }),
      ...(data.patientType !== undefined && { patientType: data.patientType }),
      ...(data.foreignNational !== undefined && { foreignNational: data.foreignNational }),
      ...(data.chronicConditions !== undefined && { chronicConditions: data.chronicConditions }),
      ...(data.currentMedications !== undefined && { currentMedications: data.currentMedications }),
      ...(data.knownAllergies !== undefined && { knownAllergies: data.knownAllergies }),
      ...(data.nextOfKinName !== undefined && { nextOfKinName: data.nextOfKinName }),
      ...(data.nextOfKinRelation !== undefined && { nextOfKinRelation: data.nextOfKinRelation }),
      ...(data.nextOfKinPhone !== undefined && { nextOfKinPhone: data.nextOfKinPhone }),
      ...(data.preferredLanguage !== undefined && { preferredLanguage: data.preferredLanguage }),
      ...(data.preferredCommChannel !== undefined && { preferredCommChannel: data.preferredCommChannel }),
      ...(data.abhaIdHash !== undefined && { abhaIdHash: data.abhaIdHash }),
      ...(data.abhaIdLast4 !== undefined && { abhaIdLast4: data.abhaIdLast4 }),
      ...(data.source !== undefined && { source: data.source }),
      ...(data.verified !== undefined && { verified: data.verified }),
      ...(data.consentVersionAccepted !== undefined && { consentVersionAccepted: data.consentVersionAccepted }),
      ...(data.consentAcceptedAt !== undefined && { consentAcceptedAt: data.consentAcceptedAt }),
      ...(data.consentSignatureId !== undefined && { consentSignatureId: data.consentSignatureId }),
      ...(data.updatedBy !== undefined && { updatedBy: data.updatedBy }),
      ...(data.updatedById !== undefined && { updatedById: data.updatedById }),
    };
    return this.prisma.patientDetails.update({ where: { id }, data: payload });
  }

  async deletePatient(id: number) {
    return this.prisma.patientDetails.delete({ where: { id } });
  }

  async getPatientByMobileNumber(mobileNo: string) {
    return this.prisma.patientDetails.findFirst({ where: { mobileNo } });
  }

  async getAllPatients() {
    return this.prisma.patientDetails.findMany();
  }

  /**
   * As-you-type PRN lookup: patients whose PRN contains `digits` anywhere,
   * best matches first — exact, then starts-with, then contains; shorter and
   * lower PRNs first within each group.
   *
   * PRN is an Int column, so "contains" can't be a Prisma filter without raw
   * SQL. Instead read only the prn column (served from its unique index, so it
   * stays fast as the table grows), match in memory, then load the few winners.
   * No cache — a patient registered a second ago is found immediately.
   */
  async searchByPrn(digits: string, limit: number) {
    const rows = await this.prisma.patientDetails.findMany({ select: { prn: true } });

    const rank = (prn: string) => (prn === digits ? 0 : prn.startsWith(digits) ? 1 : 2);
    const winners = rows
      .map((r) => String(r.prn))
      .filter((prn) => prn.includes(digits))
      .sort((a, b) => rank(a) - rank(b) || a.length - b.length || Number(a) - Number(b))
      .slice(0, limit)
      .map(Number);
    if (!winners.length) return [];

    const patients = await this.prisma.patientDetails.findMany({
      where: { prn: { in: winners } },
      // Only what the booking form fills in.
      select: { prn: true, name: true, mobileNo: true, age: true, gender: true, email: true },
    });
    const position = new Map(winners.map((prn, i) => [prn, i]));
    return patients.sort((a, b) => position.get(a.prn)! - position.get(b.prn)!);
  }
}
