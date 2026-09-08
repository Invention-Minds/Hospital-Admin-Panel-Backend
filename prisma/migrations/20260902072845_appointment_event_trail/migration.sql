-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `cancelReason` TEXT NULL,
    ADD COLUMN `cancelledAt` DATETIME(3) NULL,
    ADD COLUMN `cancelledBy` VARCHAR(191) NULL,
    ADD COLUMN `cancelledById` INTEGER NULL,
    ADD COLUMN `rescheduleCount` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `appointment_events` (
    `id` VARCHAR(191) NOT NULL,
    `appointmentId` INTEGER NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `fromDate` VARCHAR(191) NULL,
    `fromTime` VARCHAR(191) NULL,
    `fromDoctorId` INTEGER NULL,
    `fromDoctorName` VARCHAR(191) NULL,
    `fromStatus` VARCHAR(191) NULL,
    `toDate` VARCHAR(191) NULL,
    `toTime` VARCHAR(191) NULL,
    `toDoctorId` INTEGER NULL,
    `toDoctorName` VARCHAR(191) NULL,
    `toStatus` VARCHAR(191) NULL,
    `actorType` VARCHAR(191) NOT NULL,
    `actorId` INTEGER NULL,
    `actorName` VARCHAR(191) NULL,
    `actorRole` VARCHAR(191) NULL,
    `ipAddress` VARCHAR(191) NULL,
    `patientId` INTEGER NULL,
    `prnNumber` INTEGER NULL,
    `patientName` VARCHAR(191) NULL,
    `source` VARCHAR(191) NULL,
    `reason` TEXT NULL,
    `payload` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `appointment_events_appointmentId_createdAt_idx`(`appointmentId`, `createdAt`),
    INDEX `appointment_events_eventType_createdAt_idx`(`eventType`, `createdAt`),
    INDEX `appointment_events_actorId_eventType_idx`(`actorId`, `eventType`),
    INDEX `appointment_events_prnNumber_idx`(`prnNumber`),
    INDEX `appointment_events_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `appointment_events` ADD CONSTRAINT `appointment_events_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `appointments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
