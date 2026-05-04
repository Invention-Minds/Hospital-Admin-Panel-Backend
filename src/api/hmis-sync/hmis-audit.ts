import type { HmisAuditLog } from '@prisma/client';
import prisma from '../../service/prisma-client';

export type HmisAuditStatus = 'success' | 'failed' | 'pending';

export interface HmisAuditLogInput {
  direction: 'push' | 'pull';
  module: string;
  action: string;
  payload: string;
  response?: string;
  status: HmisAuditStatus;
  retryCount?: number;
}

export const createHmisAuditLog = async (
  data: HmisAuditLogInput
): Promise<HmisAuditLog | null> => {
  try {
    return await prisma.hmisAuditLog.create({
      data: {
        direction: data.direction,
        module: data.module,
        action: data.action,
        payload: data.payload,
        response: data.response,
        status: data.status,
        retryCount: data.retryCount ?? 0,
      },
    });
  } catch (error) {
    console.error('Error creating HMIS audit log:', error);
    return null;
  }
};

export const getAuditLogs = async (
  module: string,
  limit: number = 100
): Promise<HmisAuditLog[]> => {
  try {
    return await prisma.hmisAuditLog.findMany({
      where: { module },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  } catch (error) {
    console.error('Error retrieving audit logs:', error);
    return [];
  }
};

export const getFailedSyncs = async (
  limit: number = 50
): Promise<HmisAuditLog[]> => {
  try {
    return await prisma.hmisAuditLog.findMany({
      where: {
        status: 'failed',
        retryCount: { lt: 3 },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  } catch (error) {
    console.error('Error retrieving failed syncs:', error);
    return [];
  }
};

export const updateAuditLogStatus = async (
  id: number,
  status: HmisAuditStatus,
  retryCount?: number
): Promise<HmisAuditLog | null> => {
  try {
    return await prisma.hmisAuditLog.update({
      where: { id },
      data: {
        status,
        retryCount: retryCount !== undefined ? retryCount : undefined,
      },
    });
  } catch (error) {
    console.error('Error updating audit log:', error);
    return null;
  }
};
