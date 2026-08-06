-- AlterTable
ALTER TABLE `OphthalmologyPrescription` ADD COLUMN `recordedAt` DATETIME(3) NULL,
    ADD COLUMN `recordedBy` VARCHAR(191) NULL,
    ADD COLUMN `recordedById` INTEGER NULL,
    ADD COLUMN `verifiedAt` DATETIME(3) NULL,
    ADD COLUMN `verifiedBy` VARCHAR(191) NULL,
    ADD COLUMN `verifiedById` INTEGER NULL,
    ADD COLUMN `workupSnapshot` LONGTEXT NULL,
    ADD COLUMN `workupStatus` VARCHAR(191) NULL DEFAULT 'pending';

-- CreateTable
CREATE TABLE `OphthalmologyDropAdministration` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prn` INTEGER NOT NULL,
    `appointmentId` INTEGER NULL,
    `prescriptionId` VARCHAR(191) NULL,
    `drugName` VARCHAR(191) NOT NULL,
    `eye` VARCHAR(191) NOT NULL,
    `dropCount` INTEGER NOT NULL DEFAULT 1,
    `purpose` VARCHAR(191) NULL,
    `instilledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `instilledBy` VARCHAR(191) NULL,
    `instilledById` INTEGER NULL,
    `remarks` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OphthalmologyDropAdministration_prn_idx`(`prn`),
    INDEX `OphthalmologyDropAdministration_appointmentId_idx`(`appointmentId`),
    INDEX `OphthalmologyDropAdministration_instilledAt_idx`(`instilledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
