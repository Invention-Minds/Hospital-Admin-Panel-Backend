-- AlterTable
ALTER TABLE `IpdAdmission` ADD COLUMN `icuAdmittedAt` DATETIME(3) NULL,
    ADD COLUMN `icuDischargedAt` DATETIME(3) NULL,
    ADD COLUMN `priorIcuDischargeAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `IpdDischarge` ADD COLUMN `icuDays` INTEGER NULL,
    ADD COLUMN `icuOutcome` VARCHAR(191) NULL,
    ADD COLUMN `icuStay` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `icuSummary` LONGTEXT NULL,
    ADD COLUMN `intensivistSignatureId` VARCHAR(191) NULL,
    ADD COLUMN `intensivistSignedAt` DATETIME(3) NULL,
    ADD COLUMN `intensivistSignedBy` VARCHAR(191) NULL,
    ADD COLUMN `intensivistSignedById` INTEGER NULL;

-- CreateTable
CREATE TABLE `IcuVitalsReading` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL,
    `intervalMinutes` INTEGER NOT NULL DEFAULT 60,
    `hr` INTEGER NULL,
    `sbp` INTEGER NULL,
    `dbp` INTEGER NULL,
    `map` INTEGER NULL,
    `rr` INTEGER NULL,
    `spo2` INTEGER NULL,
    `temp` DOUBLE NULL,
    `gcs` INTEGER NULL,
    `cvp` INTEGER NULL,
    `ventilatorMode` VARCHAR(191) NULL,
    `fiO2` INTEGER NULL,
    `peep` INTEGER NULL,
    `pressureSupport` INTEGER NULL,
    `tidalVolume` INTEGER NULL,
    `respRateSet` INTEGER NULL,
    `abgPh` DOUBLE NULL,
    `abgPco2` DOUBLE NULL,
    `abgPo2` DOUBLE NULL,
    `abgHco3` DOUBLE NULL,
    `abgBe` DOUBLE NULL,
    `abgLactate` DOUBLE NULL,
    `inotropes` TEXT NULL,
    `notes` TEXT NULL,
    `recordedBy` VARCHAR(191) NULL,
    `recordedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IcuVitalsReading_admissionId_recordedAt_idx`(`admissionId`, `recordedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IcuProgressNote` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `noteDate` DATETIME(3) NOT NULL,
    `icuDayNumber` INTEGER NOT NULL,
    `doctorName` VARCHAR(191) NOT NULL,
    `doctorId` INTEGER NULL,
    `subjective` LONGTEXT NOT NULL,
    `objective` LONGTEXT NOT NULL,
    `assessment` LONGTEXT NOT NULL,
    `plan` LONGTEXT NOT NULL,
    `sofaScore` INTEGER NULL,
    `apacheScore` INTEGER NULL,
    `gcsScore` INTEGER NULL,
    `trajectory` VARCHAR(191) NULL,
    `signedAt` DATETIME(3) NULL,
    `signedBy` VARCHAR(191) NULL,
    `signatureId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    INDEX `IcuProgressNote_admissionId_noteDate_idx`(`admissionId`, `noteDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IcuSedationLog` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL,
    `shift` VARCHAR(191) NULL,
    `rassScore` INTEGER NULL,
    `rassBehavior` TEXT NULL,
    `cpotScore` INTEGER NULL,
    `cpotBehavior` TEXT NULL,
    `sedativeAgent` VARCHAR(191) NULL,
    `sedativeRate` VARCHAR(191) NULL,
    `analgesicAgent` VARCHAR(191) NULL,
    `analgesicRate` VARCHAR(191) NULL,
    `rassGoal` INTEGER NULL,
    `notes` TEXT NULL,
    `recordedBy` VARCHAR(191) NULL,
    `recordedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IcuSedationLog_admissionId_recordedAt_idx`(`admissionId`, `recordedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IcuRestraintLog` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `orderedAt` DATETIME(3) NOT NULL,
    `orderedBy` VARCHAR(191) NOT NULL,
    `orderedById` INTEGER NULL,
    `reason` TEXT NOT NULL,
    `restraintType` VARCHAR(191) NOT NULL,
    `bodyPart` VARCHAR(191) NULL,
    `reviewLog` LONGTEXT NULL,
    `discontinuedAt` DATETIME(3) NULL,
    `discontinuedBy` VARCHAR(191) NULL,
    `discontinuedReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IcuRestraintLog_admissionId_orderedAt_idx`(`admissionId`, `orderedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IcuBundleLog` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `chartDate` DATETIME(3) NOT NULL,
    `vapStatus` VARCHAR(191) NULL,
    `vapNotes` TEXT NULL,
    `clabsiStatus` VARCHAR(191) NULL,
    `clabsiNotes` TEXT NULL,
    `cautiStatus` VARCHAR(191) NULL,
    `cautiNotes` TEXT NULL,
    `pressureUlcerStatus` VARCHAR(191) NULL,
    `pressureUlcerNotes` TEXT NULL,
    `dvtStatus` VARCHAR(191) NULL,
    `dvtNotes` TEXT NULL,
    `glycemicControlStatus` VARCHAR(191) NULL,
    `glycemicControlNotes` TEXT NULL,
    `recordedBy` VARCHAR(191) NULL,
    `recordedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IcuBundleLog_admissionId_idx`(`admissionId`),
    UNIQUE INDEX `IcuBundleLog_admissionId_chartDate_key`(`admissionId`, `chartDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IcuFamilyCommunication` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `communicationAt` DATETIME(3) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `participantName` VARCHAR(191) NOT NULL,
    `participantRelation` VARCHAR(191) NOT NULL,
    `participantPhone` VARCHAR(191) NULL,
    `topicsDiscussed` LONGTEXT NOT NULL,
    `decisionsReached` LONGTEXT NULL,
    `secondOpinionRequested` BOOLEAN NOT NULL DEFAULT false,
    `multiPartyMeeting` BOOLEAN NOT NULL DEFAULT false,
    `documentedBy` VARCHAR(191) NOT NULL,
    `documentedById` INTEGER NULL,
    `signatureId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IcuFamilyCommunication_admissionId_communicationAt_idx`(`admissionId`, `communicationAt`),
    INDEX `IcuFamilyCommunication_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IcuStepDownRequest` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PROPOSED',
    `fromWardId` VARCHAR(191) NULL,
    `fromBedId` VARCHAR(191) NULL,
    `toWardId` VARCHAR(191) NULL,
    `toBedId` VARCHAR(191) NULL,
    `rationale` TEXT NOT NULL,
    `stepDownCriteriaMet` BOOLEAN NOT NULL DEFAULT false,
    `ongoingMeds` LONGTEXT NULL,
    `carryForwardOrders` LONGTEXT NULL,
    `codeStatus` VARCHAR(191) NULL,
    `proposedBy` VARCHAR(191) NOT NULL,
    `proposedById` INTEGER NULL,
    `proposerSignatureId` VARCHAR(191) NULL,
    `proposedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `intensivistSignedAt` DATETIME(3) NULL,
    `intensivistSignedBy` VARCHAR(191) NULL,
    `intensivistSignatureId` VARCHAR(191) NULL,
    `intensivistDeclineReason` TEXT NULL,
    `receivingNurseAcceptedAt` DATETIME(3) NULL,
    `receivingNurseName` VARCHAR(191) NULL,
    `receivingNurseSignatureId` VARCHAR(191) NULL,
    `inTransitAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `completedBy` VARCHAR(191) NULL,
    `handoverSignatureId` VARCHAR(191) NULL,
    `cancelReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IcuStepDownRequest_admissionId_status_idx`(`admissionId`, `status`),
    INDEX `IcuStepDownRequest_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `IpdAdmission_icuAdmittedAt_idx` ON `IpdAdmission`(`icuAdmittedAt`);

-- AddForeignKey
ALTER TABLE `IcuVitalsReading` ADD CONSTRAINT `IcuVitalsReading_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IcuProgressNote` ADD CONSTRAINT `IcuProgressNote_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IcuSedationLog` ADD CONSTRAINT `IcuSedationLog_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IcuRestraintLog` ADD CONSTRAINT `IcuRestraintLog_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IcuBundleLog` ADD CONSTRAINT `IcuBundleLog_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IcuFamilyCommunication` ADD CONSTRAINT `IcuFamilyCommunication_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IcuStepDownRequest` ADD CONSTRAINT `IcuStepDownRequest_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
