-- AlterTable
ALTER TABLE `ServiceAppointments` ADD COLUMN `emailSent` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `messageSent` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `smsSent` BOOLEAN NULL DEFAULT false;
