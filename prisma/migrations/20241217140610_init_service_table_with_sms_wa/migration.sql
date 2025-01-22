-- AlterTable
ALTER TABLE `Service` ADD COLUMN `checkedIn` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `emailSent` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `messageSent` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `smsSent` BOOLEAN NULL DEFAULT false,
    MODIFY `appointmentStatus` VARCHAR(191) NOT NULL DEFAULT 'pending';
