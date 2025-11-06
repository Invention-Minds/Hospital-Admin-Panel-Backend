-- AlterTable
ALTER TABLE `TherapyAppointment` ADD COLUMN `postponed` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `postponedAt` DATETIME(3) NULL,
    ADD COLUMN `postponedBy` VARCHAR(191) NULL;
