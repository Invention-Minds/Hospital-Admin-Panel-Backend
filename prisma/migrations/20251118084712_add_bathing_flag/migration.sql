-- AlterTable
ALTER TABLE `TherapyAppointment` ADD COLUMN `bathingDurationMinutes` INTEGER NULL,
    ADD COLUMN `cleaningDurationMinutes` INTEGER NULL,
    ADD COLUMN `cleaningEnded` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `cleaningEndedAt` DATETIME(3) NULL,
    ADD COLUMN `cleaningEndedBy` VARCHAR(191) NULL,
    ADD COLUMN `hasBathing` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `therapyDurationMinutes` INTEGER NULL,
    ADD COLUMN `therapyEnded` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `therapyEndedAt` DATETIME(3) NULL,
    ADD COLUMN `therapyEndedBy` VARCHAR(191) NULL,
    ADD COLUMN `totalDurationMinutes` INTEGER NULL;
