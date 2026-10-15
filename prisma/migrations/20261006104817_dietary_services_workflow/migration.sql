-- AlterTable
ALTER TABLE `DietMaster` ADD COLUMN `kind` VARCHAR(191) NOT NULL DEFAULT 'ORAL';

-- AlterTable
ALTER TABLE `DietPlan` ADD COLUMN `checkNote` VARCHAR(191) NULL,
    ADD COLUMN `disposablePlate` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `feedIntervalHours` DOUBLE NULL,
    ADD COLUMN `feedNotes` TEXT NULL,
    ADD COLUMN `feedVolumeMl` INTEGER NULL,
    ADD COLUMN `fluidRestrictionMl` INTEGER NULL,
    ADD COLUMN `foodAvoid` TEXT NULL,
    ADD COLUMN `needsCheck` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `npoFrom` DATETIME(3) NULL,
    ADD COLUMN `remarks` TEXT NULL,
    ADD COLUMN `source` VARCHAR(191) NOT NULL DEFAULT 'DIETITIAN',
    ADD COLUMN `textureId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `MealOrder` ADD COLUMN `billed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `billedAt` DATETIME(3) NULL,
    ADD COLUMN `billedBy` VARCHAR(191) NULL,
    ADD COLUMN `delayReason` TEXT NULL,
    ADD COLUMN `servedByName` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `MealTimeSlot` ADD COLUMN `orderCutoff` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `DietTexture` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `sequence` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DietTexture_name_key`(`name`),
    UNIQUE INDEX `DietTexture_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupplementMaster` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `unit` VARCHAR(191) NULL,
    `defaultDose` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SupplementMaster_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DieteticsSetting` (
    `key` VARCHAR(191) NOT NULL,
    `value` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(191) NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PatientMealInstruction` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `mealTimeSlotId` VARCHAR(191) NOT NULL,
    `instruction` TEXT NULL,
    `skip` BOOLEAN NOT NULL DEFAULT false,
    `supplementId` VARCHAR(191) NULL,
    `supplementDose` VARCHAR(191) NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PatientMealInstruction_admissionId_idx`(`admissionId`),
    UNIQUE INDEX `PatientMealInstruction_admissionId_mealTimeSlotId_key`(`admissionId`, `mealTimeSlotId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealHold` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `fromAt` DATETIME(3) NOT NULL,
    `untilAt` DATETIME(3) NULL,
    `reason` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'DIETARY',
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `liftedAt` DATETIME(3) NULL,
    `liftedBy` VARCHAR(191) NULL,

    INDEX `MealHold_admissionId_liftedAt_idx`(`admissionId`, `liftedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DietCensus` (
    `id` VARCHAR(191) NOT NULL,
    `wardId` VARCHAR(191) NOT NULL,
    `wardName` VARCHAR(191) NULL,
    `censusDate` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'SUBMITTED',
    `notes` TEXT NULL,
    `submittedBy` VARCHAR(191) NULL,
    `submittedById` INTEGER NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `signatureId` VARCHAR(191) NULL,
    `receivedBy` VARCHAR(191) NULL,
    `receivedAt` DATETIME(3) NULL,
    `acknowledgedBy` VARCHAR(191) NULL,
    `acknowledgedById` INTEGER NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DietCensus_censusDate_wardId_idx`(`censusDate`, `wardId`),
    INDEX `DietCensus_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DietCensusLine` (
    `id` VARCHAR(191) NOT NULL,
    `censusId` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `bedNumber` VARCHAR(191) NULL,
    `patientName` VARCHAR(191) NULL,
    `prn` VARCHAR(191) NULL,
    `ageSex` VARCHAR(191) NULL,
    `consultant` VARCHAR(191) NULL,
    `diagnosis` TEXT NULL,
    `dietText` VARCHAR(191) NULL,
    `dietMasterId` VARCHAR(191) NULL,
    `npo` BOOLEAN NOT NULL DEFAULT false,
    `npoFrom` DATETIME(3) NULL,
    `feedText` VARCHAR(191) NULL,
    `disposablePlate` BOOLEAN NOT NULL DEFAULT false,
    `remarks` TEXT NULL,
    `changeFlag` VARCHAR(191) NOT NULL DEFAULT 'UNCHANGED',

    INDEX `DietCensusLine_censusId_idx`(`censusId`),
    INDEX `DietCensusLine_admissionId_idx`(`admissionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DietSheet` (
    `id` VARCHAR(191) NOT NULL,
    `serviceDate` DATETIME(3) NOT NULL,
    `windowLabel` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ISSUED',
    `totalPatients` INTEGER NOT NULL DEFAULT 0,
    `noTrayPatients` INTEGER NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `snapshot` LONGTEXT NOT NULL,
    `issuedBy` VARCHAR(191) NULL,
    `issuedById` INTEGER NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `signatureId` VARCHAR(191) NULL,
    `supervisorAckBy` VARCHAR(191) NULL,
    `supervisorAckById` INTEGER NULL,
    `supervisorAckAt` DATETIME(3) NULL,
    `supervisorSignatureId` VARCHAR(191) NULL,

    INDEX `DietSheet_serviceDate_idx`(`serviceDate`),
    INDEX `DietSheet_issuedAt_idx`(`issuedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DietaryAlert` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `wardName` VARCHAR(191) NULL,
    `bedNumber` VARCHAR(191) NULL,
    `previousBed` VARCHAR(191) NULL,
    `message` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `acknowledgedAt` DATETIME(3) NULL,
    `acknowledgedBy` VARCHAR(191) NULL,

    INDEX `DietaryAlert_acknowledgedAt_idx`(`acknowledgedAt`),
    INDEX `DietaryAlert_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExtraFoodOrder` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `forWhom` VARCHAR(191) NOT NULL DEFAULT 'PATIENT',
    `item` VARCHAR(191) NOT NULL,
    `quantity` VARCHAR(191) NULL,
    `mealTimeSlotId` VARCHAR(191) NULL,
    `requestedFor` DATETIME(3) NOT NULL,
    `notes` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ORDERED',
    `requestedBy` VARCHAR(191) NULL,
    `preparedAt` DATETIME(3) NULL,
    `preparedBy` VARCHAR(191) NULL,
    `servedAt` DATETIME(3) NULL,
    `servedBy` VARCHAR(191) NULL,
    `servedByName` VARCHAR(191) NULL,
    `cancelReason` VARCHAR(191) NULL,
    `billed` BOOLEAN NOT NULL DEFAULT false,
    `billedAt` DATETIME(3) NULL,
    `billedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ExtraFoodOrder_requestedFor_status_idx`(`requestedFor`, `status`),
    INDEX `ExtraFoodOrder_admissionId_idx`(`admissionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NutritionAssessment` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `formType` VARCHAR(191) NOT NULL,
    `weightKg` DOUBLE NULL,
    `heightCm` DOUBLE NULL,
    `bmi` DOUBLE NULL,
    `ibwKg` DOUBLE NULL,
    `answers` LONGTEXT NOT NULL,
    `riskScore` DOUBLE NULL,
    `riskLevel` VARCHAR(191) NULL,
    `atRisk` BOOLEAN NOT NULL DEFAULT false,
    `energyKcal` INTEGER NULL,
    `proteinG` DOUBLE NULL,
    `fluidMl` INTEGER NULL,
    `otherNutrients` TEXT NULL,
    `intervention` TEXT NULL,
    `nextScreeningDue` DATETIME(3) NULL,
    `assessedBy` VARCHAR(191) NULL,
    `assessedById` INTEGER NULL,
    `assessedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `signatureId` VARCHAR(191) NULL,

    INDEX `NutritionAssessment_admissionId_assessedAt_idx`(`admissionId`, `assessedAt`),
    INDEX `NutritionAssessment_nextScreeningDue_idx`(`nextScreeningDue`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DietitianNote` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `note` TEXT NOT NULL,
    `writtenBy` VARCHAR(191) NULL,
    `writtenById` INTEGER NULL,
    `writtenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `signatureId` VARCHAR(191) NULL,

    INDEX `DietitianNote_admissionId_writtenAt_idx`(`admissionId`, `writtenAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DietPlan` ADD CONSTRAINT `DietPlan_textureId_fkey` FOREIGN KEY (`textureId`) REFERENCES `DietTexture`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PatientMealInstruction` ADD CONSTRAINT `PatientMealInstruction_mealTimeSlotId_fkey` FOREIGN KEY (`mealTimeSlotId`) REFERENCES `MealTimeSlot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PatientMealInstruction` ADD CONSTRAINT `PatientMealInstruction_supplementId_fkey` FOREIGN KEY (`supplementId`) REFERENCES `SupplementMaster`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DietCensusLine` ADD CONSTRAINT `DietCensusLine_censusId_fkey` FOREIGN KEY (`censusId`) REFERENCES `DietCensus`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DietCensusLine` ADD CONSTRAINT `DietCensusLine_dietMasterId_fkey` FOREIGN KEY (`dietMasterId`) REFERENCES `DietMaster`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExtraFoodOrder` ADD CONSTRAINT `ExtraFoodOrder_mealTimeSlotId_fkey` FOREIGN KEY (`mealTimeSlotId`) REFERENCES `MealTimeSlot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
