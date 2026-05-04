import axios, { AxiosInstance } from "axios";

/**
 * HMIS Client - Outbound HTTP client for pushing data to HMIS
 * Handles authentication, retries, and error handling
 */

class HmisClient {
  private client: AxiosInstance;
  private hmisBaseUrl: string;
  private hmisApiKey: string;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // ms

  constructor() {
    this.hmisBaseUrl = process.env.HMIS_BASE_URL || "http://hmis-server/api";
    this.hmisApiKey = process.env.HMIS_API_KEY || "default-key";

    this.client = axios.create({
      baseURL: this.hmisBaseUrl,
      timeout: 10000,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.hmisApiKey}`,
      },
    });
  }

  /**
   * Retry logic with exponential backoff
   */
  private async retryRequest(
    fn: () => Promise<any>,
    retryCount: number = 0
  ): Promise<any> {
    try {
      return await fn();
    } catch (error: any) {
      if (retryCount < this.maxRetries) {
        const delay =
          this.retryDelay * Math.pow(2, retryCount); // Exponential backoff
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.retryRequest(fn, retryCount + 1);
      }
      throw error;
    }
  }

  /**
   * Push patient registration to HMIS
   */
  async pushPatient(patientData: any): Promise<any> {
    try {
      const response = await this.retryRequest(() =>
        this.client.post("/patients", {
          prn: patientData.prn,
          name: patientData.name || patientData.patientName,
          dateOfBirth: patientData.dob,
          gender: patientData.gender,
          phoneNumber: patientData.phoneNumber || patientData.phone,
          email: patientData.email,
          address: patientData.address,
          bloodGroup: patientData.bloodGroup,
        })
      );

      return response.data;
    } catch (error) {
      console.error("Error pushing patient to HMIS:", error);
      throw error;
    }
  }

  /**
   * Push emergency case to HMIS
   */
  async pushEmergencyToHmis(emergencyData: any): Promise<any> {
    try {
      const response = await this.retryRequest(() =>
        this.client.post("/emergency/register", {
          prn: emergencyData.prn,
          patientName: emergencyData.patientName,
          phoneNumber: emergencyData.phoneNumber,
          age: emergencyData.age,
          gender: emergencyData.gender,
          triageCategory: emergencyData.triageCategory,
          presentingComplaint: emergencyData.presentingComplaint,
          timestamp: new Date().toISOString(),
        })
      );

      return response.data;
    } catch (error) {
      console.error("Error pushing emergency to HMIS:", error);
      throw error;
    }
  }

  /**
   * Push OPD assessment to HMIS
   */
  async pushOpdAssessment(opdData: any): Promise<any> {
    try {
      const response = await this.retryRequest(() =>
        this.client.post("/opd/assessment", {
          prn: opdData.prn,
          appointmentId: opdData.appointmentId,
          vitals: opdData.vitals,
          assessment: opdData.assessment,
          doctorName: opdData.doctorName,
          timestamp: new Date().toISOString(),
        })
      );

      return response.data;
    } catch (error) {
      console.error("Error pushing OPD assessment to HMIS:", error);
      throw error;
    }
  }

  /**
   * Push investigation order to HMIS LIS/RIS
   */
  async pushInvestigationOrder(orderData: any): Promise<any> {
    try {
      const response = await this.retryRequest(() =>
        this.client.post("/investigation/order", {
          prn: orderData.prn,
          orderId: orderData.orderId,
          labTests: orderData.labTests,
          radiologyTests: orderData.radiologyTests,
          doctorName: orderData.doctorName,
          remarks: orderData.remarks,
          timestamp: new Date().toISOString(),
        })
      );

      return response.data;
    } catch (error) {
      console.error("Error pushing investigation order to HMIS:", error);
      throw error;
    }
  }

  /**
   * Push prescription to HMIS pharmacy
   */
  async pushPrescription(prescriptionData: any): Promise<any> {
    try {
      const response = await this.retryRequest(() =>
        this.client.post("/pharmacy/prescription", {
          prn: prescriptionData.prn,
          prescriptionId: prescriptionData.prescriptionId,
          prescribedBy: prescriptionData.prescribedBy,
          medications: prescriptionData.medications,
          timestamp: new Date().toISOString(),
        })
      );

      return response.data;
    } catch (error) {
      console.error("Error pushing prescription to HMIS:", error);
      throw error;
    }
  }

  /**
   * Push IPD admission to HMIS ADT
   */
  async pushIpdAdmission(admissionData: any): Promise<any> {
    try {
      const response = await this.retryRequest(() =>
        this.client.post("/adt/admission", {
          prn: admissionData.prn,
          admissionNo: admissionData.admissionNo,
          admissionType: admissionData.admissionType,
          sourceModule: admissionData.sourceModule, // opd | emergency | direct
          doctorName: admissionData.doctorName,
          department: admissionData.department,
          diagnosis: admissionData.diagnosis,
          timestamp: new Date().toISOString(),
        })
      );

      return response.data;
    } catch (error) {
      console.error("Error pushing IPD admission to HMIS:", error);
      throw error;
    }
  }

  /**
   * Push IPD prescription mutation (continue/modify/new) to HMIS pharmacy.
   */
  async pushIpdPrescription(prescriptionData: any): Promise<any> {
    try {
      const response = await this.retryRequest(() =>
        this.client.post("/pharmacy/ipd-prescription", {
          admissionId: prescriptionData.admissionId,
          prescriptionId: prescriptionData.prescriptionId,
          prescribedBy: prescriptionData.prescribedBy,
          genericName: prescriptionData.genericName,
          brandName: prescriptionData.brandName,
          dose: prescriptionData.dose,
          frequency: prescriptionData.frequency,
          duration: prescriptionData.duration,
          route: prescriptionData.route,
          instructions: prescriptionData.instructions,
          quantity: prescriptionData.quantity,
          isCarryOver: prescriptionData.isCarryOver,
          carryOverFrom: prescriptionData.carryOverFrom,
          event: prescriptionData.event, // 'continued' | 'modified' | 'created'
          timestamp: new Date().toISOString(),
        })
      );
      return response.data;
    } catch (error) {
      console.error("Error pushing IPD prescription to HMIS:", error);
      throw error;
    }
  }

  /**
   * Push IPD prescription discontinue event to HMIS pharmacy.
   */
  async pushIpdPrescriptionDiscontinue(discontinueData: any): Promise<any> {
    try {
      const response = await this.retryRequest(() =>
        this.client.post("/pharmacy/ipd-prescription/discontinue", {
          admissionId: discontinueData.admissionId,
          prescriptionId: discontinueData.prescriptionId,
          reason: discontinueData.reason,
          discontinuedBy: discontinueData.discontinuedBy,
          timestamp: new Date().toISOString(),
        })
      );
      return response.data;
    } catch (error) {
      console.error("Error pushing IPD prescription discontinue to HMIS:", error);
      throw error;
    }
  }

  /**
   * Push a Medication Administration Record event to HMIS (MOM.4).
   */
  async pushIpdMedicationAdmin(marData: any): Promise<any> {
    try {
      const response = await this.retryRequest(() =>
        this.client.post("/pharmacy/medication-administered", {
          admissionId: marData.admissionId,
          prescriptionId: marData.prescriptionId,
          marLogId: marData.marLogId,
          administeredBy: marData.administeredBy,
          administeredAt: marData.administeredAt,
          quantity: marData.quantity,
          route: marData.route,
          remarks: marData.remarks,
          timestamp: new Date().toISOString(),
        })
      );
      return response.data;
    } catch (error) {
      console.error("Error pushing medication admin to HMIS:", error);
      throw error;
    }
  }

  /**
   * Push new MLC (Medico Legal Case) to HMIS.
   * Used at register time. HMIS returns a case id stored as hmisMlcId.
   */
  async pushMlcCase(mlcData: any): Promise<any> {
    try {
      const response = await this.retryRequest(() =>
        this.client.post("/mlc/register", {
          mlcNo: mlcData.mlcNo,
          emergencyId: mlcData.emergencyId,
          caseType: mlcData.caseType,
          policeStationName: mlcData.policeStationName,
          firNumber: mlcData.fir_No,
          firDate: mlcData.fir_Date,
          investigatingOfficer: mlcData.investigatingOfficer,
          status: mlcData.status,
          timestamp: new Date().toISOString(),
        })
      );
      return response.data;
    } catch (error) {
      console.error("Error pushing MLC case to HMIS:", error);
      throw error;
    }
  }

  /**
   * Push an MLC lifecycle update (examination / samples_collected / report_submitted).
   * The `event` field discriminates which lifecycle step this push represents.
   */
  async pushMlcUpdate(updateData: any): Promise<any> {
    try {
      const hmisMlcId = updateData.hmisMlcId ?? updateData.mlcNo;
      const response = await this.retryRequest(() =>
        this.client.put(`/mlc/${encodeURIComponent(hmisMlcId)}`, {
          event: updateData.event, // 'examination' | 'samples_collected' | 'report_submitted'
          mlcNo: updateData.mlcNo,
          status: updateData.status,
          examination: updateData.examination ?? undefined,
          samples: updateData.samples ?? undefined,
          report: updateData.report ?? undefined,
          updatedBy: updateData.updatedBy,
          timestamp: new Date().toISOString(),
        })
      );
      return response.data;
    } catch (error) {
      console.error("Error pushing MLC update to HMIS:", error);
      throw error;
    }
  }

  /**
   * Push new LAMA (Leave Against Medical Advice) record to HMIS.
   * Used at create time. HMIS returns an id stored as hmisLamaId.
   */
  async pushLamaCase(lamaData: any): Promise<any> {
    try {
      const response = await this.retryRequest(() =>
        this.client.post("/lama/register", {
          emergencyId: lamaData.emergencyId,
          lamaTime: lamaData.lamaTime,
          doctorAdvice: lamaData.doctorAdvice,
          riskExplained: lamaData.riskExplained,
          patientSignature: lamaData.patientSignature,
          witnessName: lamaData.witnessName,
          witnessSignature: lamaData.witnessSignature,
          reasonForLama: lamaData.reasonForLama,
          createdBy: lamaData.createdBy,
          timestamp: new Date().toISOString(),
        })
      );
      return response.data;
    } catch (error) {
      console.error("Error pushing LAMA to HMIS:", error);
      throw error;
    }
  }

  /**
   * Push LAMA record update (lifecycle/field edits) to HMIS.
   */
  async pushLamaUpdate(updateData: any): Promise<any> {
    try {
      const hmisLamaId = updateData.hmisLamaId ?? updateData.id;
      const response = await this.retryRequest(() =>
        this.client.put(`/lama/${encodeURIComponent(hmisLamaId)}`, {
          lamaTime: updateData.lamaTime,
          doctorAdvice: updateData.doctorAdvice,
          riskExplained: updateData.riskExplained,
          patientSignature: updateData.patientSignature,
          witnessName: updateData.witnessName,
          witnessSignature: updateData.witnessSignature,
          reasonForLama: updateData.reasonForLama,
          updatedBy: updateData.updatedBy,
          timestamp: new Date().toISOString(),
        })
      );
      return response.data;
    } catch (error) {
      console.error("Error pushing LAMA update to HMIS:", error);
      throw error;
    }
  }

  /**
   * Push new DAMA (Discharged Against Medical Advice) record to HMIS.
   */
  async pushDamaCase(damaData: any): Promise<any> {
    try {
      const response = await this.retryRequest(() =>
        this.client.post("/dama/register", {
          emergencyId: damaData.emergencyId,
          dischargeTime: damaData.dischargeTime,
          doctorRecommendation: damaData.doctorRecommendation,
          patientDeclinesAdvice: damaData.patientDeclinesAdvice,
          patientSignature: damaData.patientSignature,
          witnessName: damaData.witnessName,
          witnessSignature: damaData.witnessSignature,
          followUpAdvice: damaData.followUpAdvice,
          createdBy: damaData.createdBy,
          timestamp: new Date().toISOString(),
        })
      );
      return response.data;
    } catch (error) {
      console.error("Error pushing DAMA to HMIS:", error);
      throw error;
    }
  }

  /**
   * Push DAMA record update to HMIS.
   */
  async pushDamaUpdate(updateData: any): Promise<any> {
    try {
      const hmisDamaId = updateData.hmisDamaId ?? updateData.id;
      const response = await this.retryRequest(() =>
        this.client.put(`/dama/${encodeURIComponent(hmisDamaId)}`, {
          dischargeTime: updateData.dischargeTime,
          doctorRecommendation: updateData.doctorRecommendation,
          patientDeclinesAdvice: updateData.patientDeclinesAdvice,
          patientSignature: updateData.patientSignature,
          witnessName: updateData.witnessName,
          witnessSignature: updateData.witnessSignature,
          followUpAdvice: updateData.followUpAdvice,
          updatedBy: updateData.updatedBy,
          timestamp: new Date().toISOString(),
        })
      );
      return response.data;
    } catch (error) {
      console.error("Error pushing DAMA update to HMIS:", error);
      throw error;
    }
  }

  /**
   * Push IPD transfer to HMIS ADT
   */
  async pushIpdTransfer(transferData: any): Promise<any> {
    try {
      const response = await this.retryRequest(() =>
        this.client.post("/adt/transfer", {
          admissionId: transferData.admissionId,
          prn: transferData.prn,
          fromBedId: transferData.fromBedId,
          toBedId: transferData.toBedId,
          fromWardId: transferData.fromWardId,
          toWardId: transferData.toWardId,
          reason: transferData.reason,
          timestamp: new Date().toISOString(),
        })
      );

      return response.data;
    } catch (error) {
      console.error("Error pushing IPD transfer to HMIS:", error);
      throw error;
    }
  }

  /**
   * Push discharge to HMIS
   */
  async pushIPDDischarge(dischargeData: any): Promise<any> {
    try {
      const response = await this.retryRequest(() =>
        this.client.post("/adt/discharge", {
          admissionId: dischargeData.admissionId,
          prn: dischargeData.prn,
          dischargeDate: dischargeData.dischargeDate,
          finalDiagnosis: dischargeData.finalDiagnosis,
          dischargeSummary: dischargeData.dischargeSummary,
          timestamp: new Date().toISOString(),
        })
      );

      return response.data;
    } catch (error) {
      console.error("Error pushing discharge to HMIS:", error);
      throw error;
    }
  }

  /**
   * Poll HMIS for lab results
   */
  async pollLabResults(filters?: any): Promise<any> {
    try {
      const response = await this.client.get("/laboratory/results", {
        params: filters || { status: "pending" },
      });

      return response.data;
    } catch (error) {
      console.error("Error polling lab results from HMIS:", error);
      throw error;
    }
  }

  /**
   * Poll HMIS for radiology results
   */
  async pollRadiologyResults(filters?: any): Promise<any> {
    try {
      const response = await this.client.get("/radiology/results", {
        params: filters || { status: "pending" },
      });

      return response.data;
    } catch (error) {
      console.error("Error polling radiology results from HMIS:", error);
      throw error;
    }
  }

  /**
   * Poll HMIS for bed availability
   */
  async pollBedAvailability(): Promise<any> {
    try {
      const response = await this.client.get("/beds/availability");

      return response.data;
    } catch (error) {
      console.error("Error polling bed availability from HMIS:", error);
      throw error;
    }
  }

  /**
   * Get master data (doctors, departments, wards, beds)
   */
  async getMasterData(type: string): Promise<any> {
    try {
      const response = await this.client.get(`/master/${type}`);

      return response.data;
    } catch (error) {
      console.error(`Error fetching ${type} master data from HMIS:`, error);
      throw error;
    }
  }
}

// Export singleton instance
export const hmisClient = new HmisClient();

// Export functions for convenient usage
export const pushPatient = (data: any) => hmisClient.pushPatient(data);
export const pushEmergencyToHmis = (data: any) =>
  hmisClient.pushEmergencyToHmis(data);
export const pushOpdAssessment = (data: any) =>
  hmisClient.pushOpdAssessment(data);
export const pushInvestigationOrder = (data: any) =>
  hmisClient.pushInvestigationOrder(data);
export const pushPrescription = (data: any) =>
  hmisClient.pushPrescription(data);
export const pushIpdAdmission = (data: any) =>
  hmisClient.pushIpdAdmission(data);
export const pushIpdTransfer = (data: any) =>
  hmisClient.pushIpdTransfer(data);
export const pushIpdPrescription = (data: any) =>
  hmisClient.pushIpdPrescription(data);
export const pushIpdPrescriptionDiscontinue = (data: any) =>
  hmisClient.pushIpdPrescriptionDiscontinue(data);
export const pushIpdMedicationAdmin = (data: any) =>
  hmisClient.pushIpdMedicationAdmin(data);
export const pushMlcCase = (data: any) => hmisClient.pushMlcCase(data);
export const pushMlcUpdate = (data: any) => hmisClient.pushMlcUpdate(data);
export const pushLamaCase = (data: any) => hmisClient.pushLamaCase(data);
export const pushLamaUpdate = (data: any) => hmisClient.pushLamaUpdate(data);
export const pushDamaCase = (data: any) => hmisClient.pushDamaCase(data);
export const pushDamaUpdate = (data: any) => hmisClient.pushDamaUpdate(data);
export const pushIPDDischarge = (data: any) =>
  hmisClient.pushIPDDischarge(data);
export const pollLabResults = (filters?: any) =>
  hmisClient.pollLabResults(filters);
export const pollRadiologyResults = (filters?: any) =>
  hmisClient.pollRadiologyResults(filters);
export const pollBedAvailability = () => hmisClient.pollBedAvailability();
export const getMasterData = (type: string) => hmisClient.getMasterData(type);
