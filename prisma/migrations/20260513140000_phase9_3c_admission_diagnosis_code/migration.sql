-- Phase 9.3c — AdmissionDiagnosisCode (ICD-10 + CPT codes per admission)
-- Strictly additive: one new table + FK back to IpdAdmission.

CREATE TABLE `AdmissionDiagnosisCode` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,

    INDEX `AdmissionDiagnosisCode_admissionId_idx`(`admissionId`),
    INDEX `AdmissionDiagnosisCode_category_idx`(`category`),
    INDEX `AdmissionDiagnosisCode_admissionId_category_idx`(`admissionId`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AdmissionDiagnosisCode` ADD CONSTRAINT `AdmissionDiagnosisCode_admissionId_fkey`
    FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
