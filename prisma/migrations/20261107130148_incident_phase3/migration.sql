-- AlterTable
ALTER TABLE `Incident` ADD COLUMN `anonymous` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `subCategory` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `QualityEscalationRule` ADD COLUMN `notifySms` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `notifyWhatsapp` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `IncidentParticipant` (
    `id` VARCHAR(191) NOT NULL,
    `incidentId` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `addedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IncidentParticipant_userId_idx`(`userId`),
    UNIQUE INDEX `IncidentParticipant_incidentId_userId_key`(`incidentId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StaffAlertLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `template` VARCHAR(191) NOT NULL,
    `refType` VARCHAR(191) NULL,
    `refId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StaffAlertLog_channel_refId_status_idx`(`channel`, `refId`, `status`),
    INDEX `StaffAlertLog_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `IncidentParticipant` ADD CONSTRAINT `IncidentParticipant_incidentId_fkey` FOREIGN KEY (`incidentId`) REFERENCES `Incident`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
