-- CreateTable
CREATE TABLE `IpdVitalsReading` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `shift` VARCHAR(191) NULL,
    `temperatureC` DOUBLE NULL,
    `temperatureF` DOUBLE NULL,
    `pulse` INTEGER NULL,
    `respiration` INTEGER NULL,
    `bpSystolic` INTEGER NULL,
    `bpDiastolic` INTEGER NULL,
    `spo2` INTEGER NULL,
    `painScore` INTEGER NULL,
    `sputum` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `recordedBy` VARCHAR(191) NULL,
    `recordedById` INTEGER NULL,
    `signatureId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IpdVitalsReading_admissionId_recordedAt_idx`(`admissionId`, `recordedAt`),
    INDEX `IpdVitalsReading_recordedAt_idx`(`recordedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IpdIntakeOutputEntry` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `entryType` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `amountMl` INTEGER NOT NULL,
    `description` TEXT NULL,
    `recordedBy` VARCHAR(191) NULL,
    `recordedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IpdIntakeOutputEntry_admissionId_recordedAt_idx`(`admissionId`, `recordedAt`),
    INDEX `IpdIntakeOutputEntry_entryType_idx`(`entryType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IpdDailyChart` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `chartDate` DATETIME(3) NOT NULL,
    `postOpDay` INTEGER NULL,
    `postPartumDay` INTEGER NULL,
    `weightKg` DOUBLE NULL,
    `heightCm` DOUBLE NULL,
    `diet` TEXT NULL,
    `bowels` VARCHAR(191) NULL,
    `urine` VARCHAR(191) NULL,
    `bloodTransfusion` TEXT NULL,
    `bloodGroup` VARCHAR(191) NULL,
    `noOfTransfusions` INTEGER NULL,
    `antibiotics` TEXT NULL,
    `bath` VARCHAR(191) NULL,
    `allergy` TEXT NULL,
    `nurseSignMorningId` VARCHAR(191) NULL,
    `nurseSignMorningName` VARCHAR(191) NULL,
    `nurseSignMorningAt` DATETIME(3) NULL,
    `nurseSignEveningId` VARCHAR(191) NULL,
    `nurseSignEveningName` VARCHAR(191) NULL,
    `nurseSignEveningAt` DATETIME(3) NULL,
    `nurseSignNightId` VARCHAR(191) NULL,
    `nurseSignNightName` VARCHAR(191) NULL,
    `nurseSignNightAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,
    `updatedBy` VARCHAR(191) NULL,
    `updatedById` INTEGER NULL,

    INDEX `IpdDailyChart_chartDate_idx`(`chartDate`),
    UNIQUE INDEX `IpdDailyChart_admissionId_chartDate_key`(`admissionId`, `chartDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `IpdVitalsReading` ADD CONSTRAINT `IpdVitalsReading_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IpdIntakeOutputEntry` ADD CONSTRAINT `IpdIntakeOutputEntry_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IpdDailyChart` ADD CONSTRAINT `IpdDailyChart_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
