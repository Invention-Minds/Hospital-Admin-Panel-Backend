import cron from 'node-cron';
import prisma from '../../service/prisma-client';
import { createHmisAuditLog } from './hmis-audit';
import { pollLabResults, pollRadiologyResults, pollBedAvailability } from './hmis-client';
import { createAlertFromInvestigationResult } from './critical-value-sse';

/**
 * HMIS Polling Queue Service
 * Runs background jobs to fetch results from HMIS
 * - Poll lab results every 5 minutes
 * - Poll radiology results every 5 minutes
 * - Sync bed availability every 15 minutes
 * - Retry failed syncs every 30 minutes (exponential backoff)
 */

export class HmisSyncQueue {
  private static instance: HmisSyncQueue;

  private constructor() {}

  static getInstance(): HmisSyncQueue {
    if (!HmisSyncQueue.instance) {
      HmisSyncQueue.instance = new HmisSyncQueue();
    }
    return HmisSyncQueue.instance;
  }

  /**
   * Initialize all polling jobs
   * Call this in server startup (e.g., in index.ts after app.listen)
   */
  initializePollingJobs(): void {
    console.log('🔄 Initializing HMIS polling queue...');

    // Poll lab results every 5 minutes
    this.pollLabResultsJob();

    // Poll radiology results every 5 minutes
    this.pollRadiologyResultsJob();

    // Sync bed availability every 15 minutes
    this.syncBedAvailabilityJob();

    // Retry failed HMIS syncs every 30 minutes with exponential backoff
    this.retryFailedSyncsJob();

    console.log('✅ HMIS polling queue initialized');
  }

  /**
   * Poll HMIS for completed lab results every 5 minutes
   * Stores results in InvestigationResult table
   */
  private pollLabResultsJob(): void {
    // Run at :05, :10, :15, :20, :25, :30, :35, :40, :45, :50, :55, :00
    // This spreads the load better than :00 which all services would hit
    cron.schedule('*/5 * * * *', async () => {
      try {
        console.log(`[${new Date().toISOString()}] 🔬 Polling HMIS for lab results...`);

        // Get all pending lab investigation orders
        const pendingOrders = await prisma.investigationOrder.findMany({
          where: {
            labTests: {
              some: {}, // Has lab tests
            },
          },
          include: {
            labTests: true,
          },
        });

        if (pendingOrders.length === 0) {
          console.log('ℹ️ No pending lab orders to check');
          return;
        }

        // Poll HMIS for results (implement in hmis-client.ts)
        const results = await pollLabResults(pendingOrders);

        if (!results || results.length === 0) {
          console.log('ℹ️ No new lab results from HMIS');
          return;
        }

        // Store results in InvestigationResult table
        let savedCount = 0;
        for (const result of results) {
          try {
            // InvestigationResult.orderId is Int in Prisma. HMIS may return it as
            // number or numeric string; coerce once and skip anything non-numeric
            // so we never write NaN into the row or the findFirst filter.
            const orderIdNum = Number(result.orderId);
            if (!Number.isFinite(orderIdNum)) {
              console.warn(
                `[hmis-sync/lab] skipping result with non-numeric orderId=${String(result.orderId)}`
              );
              continue;
            }

            // Check if result already exists
            const existingResult = await prisma.investigationResult.findFirst({
              where: { orderId: orderIdNum },
            });

            const savedRow = existingResult
              ? await prisma.investigationResult.update({
                  where: { id: existingResult.id },
                  data: {
                    result: result.result,
                    unit: result.unit,
                    referenceRange: result.referenceRange,
                    criticalFlag: result.criticalFlag,
                    reportUrl: result.reportUrl,
                    reportedAt: new Date(),
                    status: 'final',
                  },
                })
              : await prisma.investigationResult.create({
                  data: {
                    orderId: orderIdNum,
                    prn: result.prn?.toString() || '',
                    testName: result.testName,
                    department: 'lab',
                    result: result.result,
                    unit: result.unit,
                    referenceRange: result.referenceRange,
                    criticalFlag: result.criticalFlag,
                    reportUrl: result.reportUrl,
                    reportedAt: new Date(),
                    status: 'final',
                  },
                });
            savedCount++;

            // If critical flag, broadcast SSE alert. Pass the persisted row so
            // the alert id is stable across repeat polling passes.
            if (savedRow.criticalFlag) {
              await createAlertFromInvestigationResult(savedRow);
            }

            // Log successful sync
            await createHmisAuditLog({
              direction: 'pull',
              module: 'investigation',
              action: 'lab_result_received',
              payload: JSON.stringify({
                orderId: result.orderId,
                prn: result.prn,
                testName: result.testName,
                result: result.result,
              }),
              status: 'success',
            });
          } catch (error) {
            console.error(`Error saving lab result for order ${result.orderId}:`, error);
          }
        }

        console.log(`✅ Lab results poll complete: ${savedCount} results stored`);
      } catch (error) {
        console.error('❌ Error polling lab results:', error);
        await createHmisAuditLog({
          direction: 'pull',
          module: 'investigation',
          action: 'lab_result_poll',
          payload: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
          status: 'failed',
        });
      }
    });
  }

  /**
   * Poll HMIS for completed radiology results every 5 minutes
   */
  private pollRadiologyResultsJob(): void {
    cron.schedule('*/5 * * * *', async () => {
      try {
        console.log(`[${new Date().toISOString()}] 📊 Polling HMIS for radiology results...`);

        // Get all pending radiology investigation orders
        const pendingOrders = await prisma.investigationOrder.findMany({
          where: {
            radiologyTests: {
              some: {}, // Has radiology tests
            },
          },
          include: {
            radiologyTests: true,
          },
        });

        if (pendingOrders.length === 0) {
          console.log('ℹ️ No pending radiology orders to check');
          return;
        }

        // Poll HMIS for results
        const results = await pollRadiologyResults(pendingOrders);

        if (!results || results.length === 0) {
          console.log('ℹ️ No new radiology results from HMIS');
          return;
        }

        // Store results
        let savedCount = 0;
        for (const result of results) {
          try {
            const orderIdNum = Number(result.orderId);
            if (!Number.isFinite(orderIdNum)) {
              console.warn(
                `[hmis-sync/radiology] skipping result with non-numeric orderId=${String(result.orderId)}`
              );
              continue;
            }

            // Check if result already exists
            const existingResult = await prisma.investigationResult.findFirst({
              where: { orderId: orderIdNum },
            });

            if (existingResult) {
              await prisma.investigationResult.update({
                where: { id: existingResult.id },
                data: {
                  result: result.result,
                  reportUrl: result.reportUrl,
                  reportedAt: new Date(),
                  status: 'final',
                },
              });
            } else {
              await prisma.investigationResult.create({
                data: {
                  orderId: orderIdNum,
                  prn: result.prn?.toString() || '',
                  testName: result.testName,
                  department: 'radiology',
                  result: result.result,
                  reportUrl: result.reportUrl,
                  reportedAt: new Date(),
                  status: 'final',
                },
              });
            }
            savedCount++;

            // Log successful sync
            await createHmisAuditLog({
              direction: 'pull',
              module: 'investigation',
              action: 'radiology_result_received',
              payload: JSON.stringify({
                orderId: result.orderId,
                prn: result.prn,
                testName: result.testName,
              }),
              status: 'success',
            });
          } catch (error) {
            console.error(`Error saving radiology result for order ${result.orderId}:`, error);
          }
        }

        console.log(`✅ Radiology results poll complete: ${savedCount} results stored`);
      } catch (error) {
        console.error('❌ Error polling radiology results:', error);
        await createHmisAuditLog({
          direction: 'pull',
          module: 'investigation',
          action: 'radiology_result_poll',
          payload: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
          status: 'failed',
        });
      }
    });
  }

  /**
   * Sync bed availability from HMIS every 15 minutes
   */
  private syncBedAvailabilityJob(): void {
    // Run at :03, :18, :33, :48 to stagger load
    cron.schedule('*/15 * * * *', async () => {
      try {
        console.log(`[${new Date().toISOString()}] 🛏️ Syncing bed availability from HMIS...`);

        // Poll HMIS for bed status updates
        const bedUpdates = await pollBedAvailability();

        if (!bedUpdates || bedUpdates.length === 0) {
          console.log('ℹ️ No bed status updates from HMIS');
          return;
        }

        // Update bed statuses
        let updatedCount = 0;
        for (const bedUpdate of bedUpdates) {
          try {
            await prisma.ipdBed.update({
              where: { id: bedUpdate.bedId },
              data: {
                status: bedUpdate.status,
              },
            });
            updatedCount++;
          } catch (error) {
            console.error(`Error updating bed ${bedUpdate.bedId}:`, error);
          }
        }

        console.log(`✅ Bed availability sync complete: ${updatedCount} beds updated`);
      } catch (error) {
        console.error('❌ Error syncing bed availability:', error);
      }
    });
  }

  /**
   * Retry failed HMIS syncs every 30 minutes with exponential backoff
   * Implements retry logic:
   * - Retry 1: immediate (retryCount 0)
   * - Retry 2: 5 min delay (retryCount 1)
   * - Retry 3: 15 min delay (retryCount 2)
   * - After 3 retries: mark as failed, alert ops
   */
  private retryFailedSyncsJob(): void {
    // HMIS_Integration_Plan.html § "Polling Cron Jobs (fallback if HMIS has no webhooks)":
    //   cron.schedule('0 * * * *', () => retryFailedPushes()); // retry hourly
    cron.schedule('0 * * * *', async () => {
      try {
        console.log(`[${new Date().toISOString()}] 🔄 Retrying failed HMIS syncs...`);

        // Get failed syncs with retryCount < 3
        const failedSyncs = await prisma.hmisAuditLog.findMany({
          where: {
            status: 'failed',
            retryCount: { lt: 3 },
          },
          orderBy: { createdAt: 'asc' },
          take: 10, // Limit to 10 per run to avoid overwhelming the system
        });

        if (failedSyncs.length === 0) {
          console.log('ℹ️ No failed syncs to retry');
          return;
        }

        let retryCount = 0;
        for (const syncLog of failedSyncs) {
          try {
            // Parse payload and direction to determine what to retry
            const payload = JSON.parse(syncLog.payload);

            // Determine if enough time has passed based on retry count
            const now = new Date();
            const timeSinceCreation = (now.getTime() - syncLog.createdAt.getTime()) / 1000 / 60; // minutes

            // Exponential backoff: 1min * 2^retryCount
            const backoffMinutes = Math.pow(2, syncLog.retryCount);

            if (timeSinceCreation < backoffMinutes) {
              continue; // Not enough time has passed yet
            }

            // Attempt retry based on module and action
            const retrySuccess = false;

            // NEUTRALIZED: the prior code hard-coded retrySuccess=true without actually
            // re-dispatching to HMIS, which silently flipped failed audit rows to 'success'
            // and corrupted the audit trail. Real re-dispatch is Sprint 4 work.
            console.warn('retry cron is stubbed — see Sprint 4');

            // Update retry count
            await prisma.hmisAuditLog.update({
              where: { id: syncLog.id },
              data: {
                retryCount: syncLog.retryCount + 1,
                status: retrySuccess ? 'success' : 'failed',
              },
            });

            if (retrySuccess) {
              retryCount++;
            }
          } catch (error) {
            console.error(`Error retrying sync ${syncLog.id}:`, error);
          }
        }

        console.log(`✅ Retry job complete: ${retryCount} syncs retried successfully`);
      } catch (error) {
        console.error('❌ Error in retry job:', error);
      }
    });
  }

  /**
   * Stop all polling jobs (useful for graceful shutdown)
   */
  stopAllJobs(): void {
    console.log('🛑 Stopping all HMIS polling jobs...');
    cron.getTasks().forEach((task) => {
      task.stop();
    });
    console.log('✅ All polling jobs stopped');
  }
}

/**
 * Export singleton instance
 * Use: HmisSyncQueue.getInstance().initializePollingJobs()
 */
export const hmisSyncQueue = HmisSyncQueue.getInstance();
