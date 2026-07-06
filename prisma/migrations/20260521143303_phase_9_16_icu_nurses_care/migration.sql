-- CreateTable
CREATE TABLE `IcuInvasiveLine` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `lineType` VARCHAR(191) NOT NULL,
    `site` VARCHAR(191) NULL,
    `insertedAt` DATETIME(3) NOT NULL,
    `removedAt` DATETIME(3) NULL,
    `removalReason` VARCHAR(191) NULL,
    `insertedBy` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `recordedBy` VARCHAR(191) NULL,
    `recordedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IcuInvasiveLine_admissionId_lineType_idx`(`admissionId`, `lineType`),
    INDEX `IcuInvasiveLine_admissionId_removedAt_idx`(`admissionId`, `removedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IcuNursingCarePlan` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `planDate` DATETIME(3) NOT NULL,
    `shift` VARCHAR(191) NULL,
    `goalPatentAirway` BOOLEAN NOT NULL DEFAULT false,
    `goalAdequateOxygenation` BOOLEAN NOT NULL DEFAULT false,
    `goalTissuePerfusion` BOOLEAN NOT NULL DEFAULT false,
    `goalFluidBalance` BOOLEAN NOT NULL DEFAULT false,
    `goalPainRelief` BOOLEAN NOT NULL DEFAULT false,
    `goalNutrition` BOOLEAN NOT NULL DEFAULT false,
    `goalPreventDvt` BOOLEAN NOT NULL DEFAULT false,
    `goalSkinIntegrity` BOOLEAN NOT NULL DEFAULT false,
    `goalActivityTolerance` BOOLEAN NOT NULL DEFAULT false,
    `goalPersonalHygiene` BOOLEAN NOT NULL DEFAULT false,
    `goalEliminationNeed` BOOLEAN NOT NULL DEFAULT false,
    `goalSafety` BOOLEAN NOT NULL DEFAULT false,
    `goalReduceAnxiety` BOOLEAN NOT NULL DEFAULT false,
    `goalCommunication` BOOLEAN NOT NULL DEFAULT false,
    `goalPatientFamilyEducation` BOOLEAN NOT NULL DEFAULT false,
    `carePlanRows` LONGTEXT NULL,
    `nurseName` VARCHAR(191) NULL,
    `nurseEmpNo` VARCHAR(191) NULL,
    `nurseSignatureId` VARCHAR(191) NULL,
    `recordedBy` VARCHAR(191) NULL,
    `recordedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IcuNursingCarePlan_admissionId_planDate_idx`(`admissionId`, `planDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IcuNurseNote` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL,
    `note` TEXT NOT NULL,
    `nurseName` VARCHAR(191) NULL,
    `nurseEmpNo` VARCHAR(191) NULL,
    `nurseSignatureId` VARCHAR(191) NULL,
    `recordedBy` VARCHAR(191) NULL,
    `recordedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IcuNurseNote_admissionId_recordedAt_idx`(`admissionId`, `recordedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `IcuInvasiveLine` ADD CONSTRAINT `IcuInvasiveLine_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IcuNursingCarePlan` ADD CONSTRAINT `IcuNursingCarePlan_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IcuNurseNote` ADD CONSTRAINT `IcuNurseNote_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
