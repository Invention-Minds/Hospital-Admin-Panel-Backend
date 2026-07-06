-- AlterTable
ALTER TABLE `Emergency` ADD COLUMN `airway` TEXT NULL,
    ADD COLUMN `breathing` TEXT NULL,
    ADD COLUMN `broughtBy` VARCHAR(191) NULL,
    ADD COLUMN `circulation` TEXT NULL,
    ADD COLUMN `conditionAtDisposition` VARCHAR(191) NULL,
    ADD COLUMN `disposition` VARCHAR(191) NULL,
    ADD COLUMN `handOffDoctorAt` DATETIME(3) NULL,
    ADD COLUMN `handOffDoctorName` VARCHAR(191) NULL,
    ADD COLUMN `handOffNurseAt` DATETIME(3) NULL,
    ADD COLUMN `handOffNurseName` VARCHAR(191) NULL,
    ADD COLUMN `historyGivenBy` VARCHAR(191) NULL,
    ADD COLUMN `identificationMark` TEXT NULL,
    ADD COLUMN `mentalStatus` VARCHAR(191) NULL,
    ADD COLUMN `modeOfArrival` VARCHAR(191) NULL,
    ADD COLUMN `painScore` INTEGER NULL,
    ADD COLUMN `policeInformationGiven` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `pupilsLeft` VARCHAR(191) NULL,
    ADD COLUMN `pupilsRight` VARCHAR(191) NULL,
    ADD COLUMN `reasonsForMlc` TEXT NULL,
    ADD COLUMN `receivingDoctorAt` DATETIME(3) NULL,
    ADD COLUMN `receivingDoctorName` VARCHAR(191) NULL,
    ADD COLUMN `receivingNurseAt` DATETIME(3) NULL,
    ADD COLUMN `receivingNurseName` VARCHAR(191) NULL,
    ADD COLUMN `referralFrom` VARCHAR(191) NULL,
    ADD COLUMN `referredTo` VARCHAR(191) NULL,
    ADD COLUMN `secondarySurvey` LONGTEXT NULL,
    ADD COLUMN `workingDiagnosis` TEXT NULL;

-- AlterTable
ALTER TABLE `IpdInitialAssessment` ADD COLUMN `isLactating` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `isPregnant` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `pregnancyWeeks` INTEGER NULL;

-- CreateTable
CREATE TABLE `DayCareSession` (
    `id` VARCHAR(191) NOT NULL,
    `prn` VARCHAR(191) NULL,
    `patientName` VARCHAR(191) NOT NULL,
    `age` INTEGER NULL,
    `gender` VARCHAR(191) NULL,
    `dateOfService` DATETIME(3) NOT NULL,
    `procedureType` VARCHAR(191) NOT NULL,
    `procedureDetails` TEXT NULL,
    `allergies` TEXT NULL,
    `consultantName` VARCHAR(191) NULL,
    `spo2Low` INTEGER NULL,
    `spo2High` INTEGER NULL,
    `bpSystolicLow` INTEGER NULL,
    `bpSystolicHigh` INTEGER NULL,
    `bpDiastolicLow` INTEGER NULL,
    `bpDiastolicHigh` INTEGER NULL,
    `hrLow` INTEGER NULL,
    `hrHigh` INTEGER NULL,
    `rrLow` INTEGER NULL,
    `rrHigh` INTEGER NULL,
    `tempLow` DOUBLE NULL,
    `tempHigh` DOUBLE NULL,
    `uopLow` INTEGER NULL,
    `uopHigh` INTEGER NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `dischargedAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,
    `updatedBy` VARCHAR(191) NULL,
    `updatedById` INTEGER NULL,

    INDEX `DayCareSession_prn_idx`(`prn`),
    INDEX `DayCareSession_dateOfService_idx`(`dateOfService`),
    INDEX `DayCareSession_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DayCareReading` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `spo2` INTEGER NULL,
    `bpSystolic` INTEGER NULL,
    `bpDiastolic` INTEGER NULL,
    `hr` INTEGER NULL,
    `rr` INTEGER NULL,
    `tempF` DOUBLE NULL,
    `uopMl` INTEGER NULL,
    `ivPatency` VARCHAR(191) NULL,
    `consciousnessLevel` INTEGER NULL,
    `remarks` TEXT NULL,
    `alertsTriggered` TEXT NULL,
    `recordedBy` VARCHAR(191) NULL,
    `recordedById` INTEGER NULL,
    `signatureId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DayCareReading_sessionId_recordedAt_idx`(`sessionId`, `recordedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IpdNonDrugOrder` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `orderedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `doctorName` VARCHAR(191) NOT NULL,
    `doctorId` INTEGER NULL,
    `doctorSignatureId` VARCHAR(191) NULL,
    `orderText` TEXT NOT NULL,
    `category` VARCHAR(191) NULL,
    `acknowledgedByName` VARCHAR(191) NULL,
    `acknowledgedById` INTEGER NULL,
    `acknowledgedSignatureId` VARCHAR(191) NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `completedByName` VARCHAR(191) NULL,
    `completedById` INTEGER NULL,
    `completedAt` DATETIME(3) NULL,
    `completionNotes` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ORDERED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `updatedBy` VARCHAR(191) NULL,

    INDEX `IpdNonDrugOrder_admissionId_orderedAt_idx`(`admissionId`, `orderedAt`),
    INDEX `IpdNonDrugOrder_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DayCareReading` ADD CONSTRAINT `DayCareReading_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `DayCareSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IpdNonDrugOrder` ADD CONSTRAINT `IpdNonDrugOrder_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
