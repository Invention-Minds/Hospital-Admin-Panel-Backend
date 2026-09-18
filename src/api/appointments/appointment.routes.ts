import { Router } from 'express';
import {
    createAppointment, getAppointments, updateAppointment, deleteAppointment, getTotalAppointments,
    getPendingAppointments, getAppointmentsByUser, getDoctorReport, lockAppointment, unlockAppointment, scheduleCompletion,registerForUpdates,checkInAppointment,
    getAppointmentsBySlot,
    getAllNotifications,
    deleteNotification,
    updateExtraWaitingTime,
    bulkUpdateAppointments,
    bulkUpdateAccepted,
    bulkUpdateCancel,
    getAppointmentByServiceId,
    createNewAppointment,
    getCheckinAppointments,
    todayCheckedInAppointments,
    confirmedAppointments,
    cancelledAppointments,
    completedAppointments,
    PendingAppointments,
    getTransferAppointments,
    getReferredAppointments,
    getFollowUpAppointments,
    pastConsultations,
    futureConsultations,
    confirmedMhc,
    mhcReportAppointment,
    opdRequestWise,
    opdTimeWise,
    opdTypeWise,
    opdStatusWise,
    prnWiseAppointment,
    opdGenderWise,
    checkedOutAppointments,
    getDoctorTodayReport,
    getAppointmentById,
    getCheckedInAppointmentsByDateRange,
    broadcastConsultationStart,
    consultationSummary,
    sendVisitSummary,
    getAppointmentHistory,
    getAppointmentEventReport,
    getAppointmentEventSummary,
    undoCheckIn
} from './appointment.controller';
import { authenticateToken } from '../../middleware/middleware';
import { optionalAuth } from '../../middleware/optional-auth';
import { requireRole } from '../../middleware/require-role';
import { requireClinicalActor } from '../../middleware/audit-guard';

const router = Router();
router.get('/updates', registerForUpdates);
router.post('/notify-consultation-start', broadcastConsultationStart);
// Both stay public — anonymous website booking must keep working. optionalAuth
// only decodes a token when one is sent (the admin panel always does), so a
// staff booking is attributed to that user in the lifecycle trail instead of
// being recorded as "unknown". It never rejects a request.
router.post('/', optionalAuth, createAppointment);
router.post('/new', optionalAuth, createNewAppointment);
// Sends a clinical document to the patient — needs an identified actor for the
// audit row that records every send.
router.post('/send-visit-summary', authenticateToken, requireClinicalActor, sendVisitSummary);
router.put('/bulk-updates-accept', bulkUpdateAccepted);
router.get('/', authenticateToken, getAppointments);
router.put('/bulk-cancel', authenticateToken, bulkUpdateCancel)
router.put('/bulk-update', bulkUpdateAppointments);
router.put('/:id', authenticateToken, updateAppointment);
router.delete('/:id', authenticateToken, deleteAppointment);
router.get('/total', authenticateToken, getTotalAppointments);
router.get('/check-in', authenticateToken, getCheckinAppointments);
router.get('/opd-requestVia', authenticateToken, opdRequestWise);
router.get('/opd-time',authenticateToken, opdTimeWise);
router.get('/opd-type',authenticateToken, opdTypeWise);
router.get('/opd-status',authenticateToken, opdStatusWise);
router.get('/prn-wise',authenticateToken, prnWiseAppointment);
router.get('/opd-gender',authenticateToken, opdGenderWise)
router.get('/today-checkin', authenticateToken, todayCheckedInAppointments);
router.get('/consultation-summary', authenticateToken, consultationSummary);
router.get('/confirmed-appts', authenticateToken, confirmedAppointments);
router.get('/cancelled-appts', authenticateToken, cancelledAppointments);
router.get('/completed-appts', authenticateToken, completedAppointments);
router.get('/pending-appts', authenticateToken, PendingAppointments);
router.get('/transfer-appts',authenticateToken, getTransferAppointments);
router.get('/referred-appts',authenticateToken, getReferredAppointments);
router.get('/followup-appts',authenticateToken, getFollowUpAppointments);
router.get('/past-consultations',authenticateToken, pastConsultations);
router.get('/future-consultations', authenticateToken, futureConsultations);
router.get('/mhc-report-appts', authenticateToken, mhcReportAppointment);
router.get('/get-checkedOut', authenticateToken, checkedOutAppointments)
router.get('/pending', authenticateToken, getPendingAppointments);
router.get('/checkin-reports', authenticateToken, getCheckedInAppointmentsByDateRange);
router.get('/mhc-appts',authenticateToken, confirmedMhc);
router.get('/by-user', authenticateToken, getAppointmentsByUser);
router.get('/by-doctor', getDoctorReport);
router.get('/by-doctor-today', authenticateToken, getDoctorTodayReport);
router.get('/slotsbyappointments',authenticateToken,getAppointmentsBySlot)
router.get('/appts-by-serviceId', getAppointmentByServiceId)
router.put('/:id/lock', authenticateToken, lockAppointment);
router.put('/:id/unlock', authenticateToken, unlockAppointment);
router.put('/:id/schedule-completion', scheduleCompletion);
router.put('/:id/checkin', authenticateToken, checkInAppointment);
// Correction for a check-in on the wrong appointment. Reception (sub_admin)
// and admin can both do it; super_admin passes by default. Doctors cannot.
router.put('/:id/undo-checkin', authenticateToken, requireRole({ roles: ['admin', 'sub_admin'] }), undoCheckIn);
router.put('/:id/waitingTime', updateExtraWaitingTime);
router.get('/notifications', getAllNotifications);
router.delete('/notifications/:id', deleteNotification);
// Lifecycle trail. All must stay ABOVE the catch-all '/:appointmentId'.
router.post('/event-summary', authenticateToken, getAppointmentEventSummary);
router.get('/reschedule-report', authenticateToken, getAppointmentEventReport);
router.get('/:id/history', authenticateToken, getAppointmentHistory);
router.get('/:appointmentId', authenticateToken, getAppointmentById);



export default router;
