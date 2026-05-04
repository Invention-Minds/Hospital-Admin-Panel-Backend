import { pushPrescription } from "../hmis-sync/hmis-client";
import { syncWithHmis } from "../hmis-sync/hmis-sync-wrapper";

interface PrescribedTablet {
  genericName: string;
  brandName: string;
  frequency: string;
  duration: string;
  route?: string | null;
  instructions: string;
  quantity: number;
}

interface PrescriptionForSync {
  prn: string;
  prescriptionId: string;
  prescribedBy: string;
  prescribedByKMC?: string | null;
  tablets?: PrescribedTablet[];
}

/**
 * Sync prescription to HMIS pharmacy via the audit-wrapped pipeline.
 */
export const syncPrescriptionToHmis = async (
  prescriptionData: PrescriptionForSync
): Promise<void> => {
  const hmisPayload = {
    prn: prescriptionData.prn,
    prescriptionId: prescriptionData.prescriptionId,
    prescribedBy: prescriptionData.prescribedBy,
    prescribedByKMC: prescriptionData.prescribedByKMC,
    medications: prescriptionData.tablets?.map((t) => ({
      genericName: t.genericName,
      brandName: t.brandName,
      dose: t.frequency,
      duration: t.duration,
      route: t.route || "oral",
      instructions: t.instructions,
      quantity: t.quantity,
    })),
    timestamp: new Date().toISOString(),
  };

  await syncWithHmis({
    direction: "push",
    module: "pharmacy",
    entityType: "prescription",
    action: "prescription_created",
    payload: prescriptionData,
    operation: () => pushPrescription(hmisPayload),
  });
};
