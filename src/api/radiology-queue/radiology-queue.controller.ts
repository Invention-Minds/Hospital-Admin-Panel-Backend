import { Request, Response } from "express";
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
import axios from "axios";

function getCurrentHourSlot() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000); // +1 hour
    return { start, end };
}


/** Count check-ins in last hour */
async function getCheckInCountLastHour(): Promise<number> {
    const { start, end } = getCurrentHourSlot();
    return prisma.serviceAppointments.count({
        where: {
            checkedIn: true,
            checkedInTime: { gte: start, lt: end },
        },
    });
}

/** Send WhatsApp notification */
async function sendWhatsAppNotification(
    phoneNumber: string,
    count: any,
) {
    const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
    const url = process.env.WHATSAPP_API_URL;

    const payload = {
        from: fromPhoneNumber,
        to: phoneNumber,
        type: "template",
        message: {
            templateid: "881059",
            placeholders: [count],
        },
    };

    const headers = {
        "Content-Type": "application/json",
        apikey: process.env.WHATSAPP_AUTH_TOKEN!,
    };

    const response = await axios.post(url!, payload, { headers });
    return response.data;
}

/** Threshold deduplication: check if already sent in last 1 hour */
async function wasThresholdSentRecently(threshold: number): Promise<boolean> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const log = await prisma.whatsAppThresholdLog.findFirst({
        where: {
            threshold,
            sentAt: { gte: oneHourAgo },
        },
    });
    return !!log;
}

/** Log threshold message */
async function logThresholdNotification(threshold: number) {
    await prisma.whatsAppThresholdLog.create({
        data: { threshold },
    });
}

/** Update lock status if > 35 */
async function updateLockStatus(count: number) {
    let lock = await prisma.systemLock.findUnique({
        where: { lockType: "radio-check-in" },
    });

    console.log(`Current check-in count: ${count}`);
    const { start, end } = getCurrentHourSlot();

    // If >35 in this hour, lock until next hour starts
    if (count > 35) {
        if (!lock) {
            return prisma.systemLock.create({
                data: { lockType: "radio-check-in", isActive: true, activatedAt: start },
            });
        } else if (!lock.isActive) {
            return prisma.systemLock.update({
                where: { lockType: "radio-check-in" },
                data: { isActive: true, activatedAt: start },
            });
        }
    }

    // At next hour, auto-release lock
    if (lock?.isActive && new Date() >= end) {
        return prisma.systemLock.update({
            where: { lockType: "radio-check-in" },
            data: { isActive: false, releasedAt: new Date() },
        });
    }

    return lock;
}

/** Get lock status */
export async function getLock(req: Request, res: Response) {
    const lock = await prisma.systemLock.findUnique({
        where: { lockType: "radio-check-in" },
    });
    res.json({ isActive: lock?.isActive || false });
    return;
}

/** Manual unlock */
export async function manualUnlock(req: Request, res: Response) {
    // Step 1: Check if any active lock exists
    const activeLock = await prisma.systemLock.findFirst({
        where: {
            lockType: "radio-check-in",
            isActive: true,
        },
    });

    // Step 2: If no active lock found, return error
    if (!activeLock) {
         res.status(406).json({
            message: "No active check-in lock found to unlock",
        });
        return;
    }
    await prisma.systemLock.updateMany({
        where: { lockType: "radio-check-in" },
        data: { isActive: false, releasedAt: new Date() },
    });
    res.json({ message: "Check-ins unlocked manually" });
    return;
}

/** Complete check-in */
export async function completeCheckIn(req: Request, res: Response) {
    try {
        const serviceId = parseInt(req.params.id);

        // Check if locked
        const lock = await prisma.systemLock.findUnique({
            where: { lockType: "radio-check-in" },
        });
        if (lock?.isActive) {
            // If locked, check if queue limit exceeded
            if (lock.activatedAt) {
                const nextHourBoundary = new Date(
                    lock.activatedAt.getFullYear(),
                    lock.activatedAt.getMonth(),
                    lock.activatedAt.getDate(),
                    lock.activatedAt.getHours() + 1,
                    0, 0, 0
                );

                if (new Date() >= nextHourBoundary) {
                    const release = await prisma.systemLock.update({
                        where: { lockType: "radio-check-in" },
                        data: { isActive: false, releasedAt: new Date() },
                    });
                }
                else {
                    res.status(406).json({
                        message: "Check-in temporarily disabled. Queue limit exceeded.",
                    });
                    return;
                }
            }
            else {
                // Safety: if activatedAt is somehow null, treat as locked
                res.status(406).json({
                    message: "Check-in temporarily disabled. Queue limit exceeded.",
                });
                return;
            }

        }

        // Update service as checked in
        const updatedService = await prisma.serviceAppointments.update({
            where: { id: serviceId },
            data: { checkedIn: true, checkedInTime: new Date() },
        });

        // Count last hour check-ins
        const count = await getCheckInCountLastHour();
        console.log(`Check-ins in last hour: ${count}`);

        // Notify thresholds if applicable
        const thresholds = [20, 25, 30, 35];
        if (thresholds.includes(count)) {
            // const alreadySent = await wasThresholdSentRecently(count);
            const phoneNumbers = ['919342287945', '917708059010', '916382348092'];
            // const phoneNumbers =['919620306613', '916364833988', '919880544866'];

            await Promise.all(
                phoneNumbers.map(num => sendWhatsAppNotification(num, count))
            );
                console.log(`WhatsApp notification sent for threshold ${count}`);
                await logThresholdNotification(count);
            
        }

        // Update lock
        const updatedLock = await updateLockStatus(count);

        res.json({
            message: "Checked in successfully",
            count,
            lock: updatedLock?.isActive || false,
        });
        return;
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ message: error.message });
        return;
    }
}
