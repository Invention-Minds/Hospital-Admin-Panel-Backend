import cron from 'node-cron';
import AppointmentRepository from './appointment.repository';

const repository = new AppointmentRepository();
const scheduledTasks = new Map<number, cron.ScheduledTask>();

export function scheduleAppointmentCompletionJob(appointmentId: number, delayMinutes: number): void {
  // Stop the existing task for the appointment if there's any
  if (scheduledTasks.has(appointmentId)) {
    scheduledTasks.get(appointmentId)?.stop();
  }

  const cronExpression = `*/${delayMinutes} * * * *`;
  const task = cron.schedule(cronExpression, async () => {
    try {
      await repository.completeAppointment(appointmentId);
      console.log(`Appointment ${appointmentId} marked as completed.`);
      task.stop();
      scheduledTasks.delete(appointmentId);
    } catch (error) {
      console.error('Error marking appointment as completed:', error);
    }
  });

  scheduledTasks.set(appointmentId, task);
}

