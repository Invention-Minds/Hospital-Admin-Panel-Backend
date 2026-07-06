-- AlterTable
ALTER TABLE `IpdVitalsReading` ADD COLUMN `consciousnessAcvpu` VARCHAR(191) NULL,
    ADD COLUMN `onSupplementalOxygen` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `PatientAcuitySnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `ewsScore` INTEGER NOT NULL,
    `ewsBand` VARCHAR(191) NOT NULL,
    `componentScores` TEXT NULL,
    `trend` VARCHAR(191) NULL,
    `risingStreak` BOOLEAN NOT NULL DEFAULT false,
    `vitalsReadingId` VARCHAR(191) NULL,
    `vitalsRecordedAt` DATETIME(3) NULL,
    `computedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PatientAcuitySnapshot_admissionId_computedAt_idx`(`admissionId`, `computedAt`),
    INDEX `PatientAcuitySnapshot_ewsBand_idx`(`ewsBand`),
    INDEX `PatientAcuitySnapshot_computedAt_idx`(`computedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AcuityEscalation` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `ewsScore` INTEGER NULL,
    `note` TEXT NULL,
    `byName` VARCHAR(191) NULL,
    `byId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AcuityEscalation_admissionId_createdAt_idx`(`admissionId`, `createdAt`),
    INDEX `AcuityEscalation_action_idx`(`action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PatientAcuitySnapshot` ADD CONSTRAINT `PatientAcuitySnapshot_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AcuityEscalation` ADD CONSTRAINT `AcuityEscalation_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
