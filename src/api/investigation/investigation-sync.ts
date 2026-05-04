import { pushInvestigationOrder } from "../hmis-sync/hmis-client";
import { syncWithHmis } from "../hmis-sync/hmis-sync-wrapper";

interface InvestigationTest {
  id: number;
  description: string;
  department: string;
}

interface InvestigationOrderForSync {
  id: number;
  prn: string;
  labTests?: InvestigationTest[];
  radiologyTests?: InvestigationTest[];
  doctorName?: string;
  remarks?: string | null;
}

/**
 * Sync investigation order to HMIS LIS/RIS via the audit-wrapped pipeline.
 */
export const syncInvestigationOrderToHmis = async (
  orderData: InvestigationOrderForSync
): Promise<void> => {
  const hmisPayload = {
    prn: orderData.prn,
    orderId: orderData.id,
    labTests: orderData.labTests?.map((t) => ({
      code: t.id,
      name: t.description,
      department: t.department,
    })),
    radiologyTests: orderData.radiologyTests?.map((t) => ({
      code: t.id,
      name: t.description,
      department: t.department,
    })),
    doctorName: orderData.doctorName,
    remarks: orderData.remarks,
  };

  await syncWithHmis({
    direction: "push",
    module: "investigation",
    entityType: "investigation-order",
    action: "create",
    payload: orderData,
    operation: () => pushInvestigationOrder(hmisPayload),
  });
};
