-- CreateTable
CREATE TABLE `OtRoom` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `equipmentClass` VARCHAR(191) NULL,
    `hepaFiltered` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'available',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OtRoom_code_key`(`code`),
    INDEX `OtRoom_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OtSchedule` (
    `id` VARCHAR(191) NOT NULL,
    `otRoomId` VARCHAR(191) NOT NULL,
    `estimationId` VARCHAR(191) NULL,
    `admissionId` VARCHAR(191) NULL,
    `prn` VARCHAR(191) NULL,
    `patientName` VARCHAR(191) NULL,
    `date` DATETIME(3) NOT NULL,
    `plannedStart` DATETIME(3) NOT NULL,
    `plannedEnd` DATETIME(3) NOT NULL,
    `actualStart` DATETIME(3) NULL,
    `actualEnd` DATETIME(3) NULL,
    `surgeonId` INTEGER NULL,
    `surgeonName` VARCHAR(191) NULL,
    `anaesthesiologistId` INTEGER NULL,
    `anaesthesiologistName` VARCHAR(191) NULL,
    `scrubNurseId` INTEGER NULL,
    `scrubNurseName` VARCHAR(191) NULL,
    `runnerId` INTEGER NULL,
    `runnerName` VARCHAR(191) NULL,
    `procedureName` VARCHAR(191) NOT NULL,
    `procedureCode` VARCHAR(191) NULL,
    `urgency` VARCHAR(191) NOT NULL DEFAULT 'elective',
    `status` VARCHAR(191) NOT NULL DEFAULT 'BOOKED',
    `cancelReason` TEXT NULL,
    `rescheduledFromId` VARCHAR(191) NULL,
    `preOpChecklistId` VARCHAR(191) NULL,
    `safetyChecklistId` VARCHAR(191) NULL,
    `intraOpNoteId` VARCHAR(191) NULL,
    `pacuRecordId` VARCHAR(191) NULL,
    `outcomeId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,

    UNIQUE INDEX `OtSchedule_preOpChecklistId_key`(`preOpChecklistId`),
    UNIQUE INDEX `OtSchedule_safetyChecklistId_key`(`safetyChecklistId`),
    UNIQUE INDEX `OtSchedule_intraOpNoteId_key`(`intraOpNoteId`),
    UNIQUE INDEX `OtSchedule_pacuRecordId_key`(`pacuRecordId`),
    UNIQUE INDEX `OtSchedule_outcomeId_key`(`outcomeId`),
    INDEX `OtSchedule_date_idx`(`date`),
    INDEX `OtSchedule_status_idx`(`status`),
    INDEX `OtSchedule_otRoomId_date_idx`(`otRoomId`, `date`),
    INDEX `OtSchedule_admissionId_idx`(`admissionId`),
    INDEX `OtSchedule_prn_idx`(`prn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OtPreOpChecklist` (
    `id` VARCHAR(191) NOT NULL,
    `scheduleId` VARCHAR(191) NOT NULL,
    `fasting` BOOLEAN NOT NULL DEFAULT false,
    `fastingHours` INTEGER NULL,
    `consentSignatureId` VARCHAR(191) NULL,
    `groupTyped` BOOLEAN NOT NULL DEFAULT false,
    `crossMatched` BOOLEAN NOT NULL DEFAULT false,
    `bloodReservedUnits` INTEGER NULL,
    `antibioticPlanned` BOOLEAN NOT NULL DEFAULT false,
    `antibioticName` VARCHAR(191) NULL,
    `prophylaxisGiven` BOOLEAN NOT NULL DEFAULT false,
    `surgicalSiteMarked` BOOLEAN NOT NULL DEFAULT false,
    `allergiesReviewed` BOOLEAN NOT NULL DEFAULT false,
    `allergiesNote` TEXT NULL,
    `fitnessCleared` BOOLEAN NOT NULL DEFAULT false,
    `fitnessClearedBy` VARCHAR(191) NULL,
    `preAnaesthesiaNotes` TEXT NULL,
    `signedAt` DATETIME(3) NULL,
    `signedBy` VARCHAR(191) NULL,
    `signedById` INTEGER NULL,
    `signatureId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OtPreOpChecklist_scheduleId_key`(`scheduleId`),
    INDEX `OtPreOpChecklist_scheduleId_idx`(`scheduleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OtSafetyChecklist` (
    `id` VARCHAR(191) NOT NULL,
    `scheduleId` VARCHAR(191) NOT NULL,
    `signInAt` DATETIME(3) NULL,
    `signInBy` VARCHAR(191) NULL,
    `signInSignatureId` VARCHAR(191) NULL,
    `patientIdentityConfirmed` BOOLEAN NOT NULL DEFAULT false,
    `siteMarked` BOOLEAN NOT NULL DEFAULT false,
    `anaesthesiaSafetyChecked` BOOLEAN NOT NULL DEFAULT false,
    `pulseOximeterFunctional` BOOLEAN NOT NULL DEFAULT false,
    `knownAllergies` BOOLEAN NOT NULL DEFAULT false,
    `difficultAirwayRisk` BOOLEAN NOT NULL DEFAULT false,
    `bloodLossRisk` BOOLEAN NOT NULL DEFAULT false,
    `timeOutAt` DATETIME(3) NULL,
    `timeOutBy` VARCHAR(191) NULL,
    `timeOutSignatureId` VARCHAR(191) NULL,
    `teamIntroduced` BOOLEAN NOT NULL DEFAULT false,
    `procedureConfirmed` BOOLEAN NOT NULL DEFAULT false,
    `antibioticAdministered` BOOLEAN NOT NULL DEFAULT false,
    `imagingDisplayed` BOOLEAN NOT NULL DEFAULT false,
    `criticalEventsAnticipated` BOOLEAN NOT NULL DEFAULT false,
    `signOutAt` DATETIME(3) NULL,
    `signOutBy` VARCHAR(191) NULL,
    `signOutSignatureId` VARCHAR(191) NULL,
    `procedureRecordedName` VARCHAR(191) NULL,
    `swabCount` BOOLEAN NOT NULL DEFAULT false,
    `swabCountInitial` INTEGER NULL,
    `swabCountFinal` INTEGER NULL,
    `instrumentCount` BOOLEAN NOT NULL DEFAULT false,
    `instrumentCountInitial` INTEGER NULL,
    `instrumentCountFinal` INTEGER NULL,
    `specimenLabelled` BOOLEAN NOT NULL DEFAULT false,
    `equipmentIssues` TEXT NULL,
    `recoveryConcerns` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OtSafetyChecklist_scheduleId_key`(`scheduleId`),
    INDEX `OtSafetyChecklist_scheduleId_idx`(`scheduleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OtIntraOpNote` (
    `id` VARCHAR(191) NOT NULL,
    `scheduleId` VARCHAR(191) NOT NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NULL,
    `anaesthesiaType` VARCHAR(191) NULL,
    `surgeons` VARCHAR(191) NULL,
    `findings` LONGTEXT NULL,
    `procedureDone` LONGTEXT NULL,
    `bloodLossMl` INTEGER NULL,
    `fluidsMl` INTEGER NULL,
    `complications` LONGTEXT NULL,
    `implants` LONGTEXT NULL,
    `signedAt` DATETIME(3) NULL,
    `signedBy` VARCHAR(191) NULL,
    `signedById` INTEGER NULL,
    `signatureId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OtIntraOpNote_scheduleId_key`(`scheduleId`),
    INDEX `OtIntraOpNote_scheduleId_idx`(`scheduleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OtAnaesthesiaChart` (
    `id` VARCHAR(191) NOT NULL,
    `scheduleId` VARCHAR(191) NOT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `hr` INTEGER NULL,
    `sbp` INTEGER NULL,
    `dbp` INTEGER NULL,
    `spo2` INTEGER NULL,
    `etco2` INTEGER NULL,
    `drugs` TEXT NULL,
    `fluids` TEXT NULL,
    `remarks` TEXT NULL,
    `recordedBy` VARCHAR(191) NULL,
    `recordedById` INTEGER NULL,

    INDEX `OtAnaesthesiaChart_scheduleId_timestamp_idx`(`scheduleId`, `timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PacuRecord` (
    `id` VARCHAR(191) NOT NULL,
    `scheduleId` VARCHAR(191) NOT NULL,
    `arrivalAt` DATETIME(3) NULL,
    `dischargedAt` DATETIME(3) NULL,
    `dischargedTo` VARCHAR(191) NULL,
    `dischargedToWardId` VARCHAR(191) NULL,
    `dischargedToBedId` VARCHAR(191) NULL,
    `arrivalHr` INTEGER NULL,
    `arrivalSbp` INTEGER NULL,
    `arrivalDbp` INTEGER NULL,
    `arrivalSpo2` INTEGER NULL,
    `arrivalRr` INTEGER NULL,
    `arrivalTemp` DOUBLE NULL,
    `arrivalGcs` INTEGER NULL,
    `painScore` INTEGER NULL,
    `dischargeCriteria` TEXT NULL,
    `dischargeCriteriaMet` BOOLEAN NOT NULL DEFAULT false,
    `signedBy` VARCHAR(191) NULL,
    `signedById` INTEGER NULL,
    `signatureId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PacuRecord_scheduleId_key`(`scheduleId`),
    INDEX `PacuRecord_scheduleId_idx`(`scheduleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PacuVital` (
    `id` VARCHAR(191) NOT NULL,
    `pacuRecordId` VARCHAR(191) NOT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `hr` INTEGER NULL,
    `sbp` INTEGER NULL,
    `dbp` INTEGER NULL,
    `spo2` INTEGER NULL,
    `rr` INTEGER NULL,
    `temp` DOUBLE NULL,
    `painScore` INTEGER NULL,
    `recordedBy` VARCHAR(191) NULL,

    INDEX `PacuVital_pacuRecordId_timestamp_idx`(`pacuRecordId`, `timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OtOutcome` (
    `id` VARCHAR(191) NOT NULL,
    `scheduleId` VARCHAR(191) NOT NULL,
    `unplannedReturn` BOOLEAN NOT NULL DEFAULT false,
    `linkedScheduleId` VARCHAR(191) NULL,
    `surgicalSiteInfection` BOOLEAN NOT NULL DEFAULT false,
    `ssiDetectedAt` DATETIME(3) NULL,
    `ssiOrganism` VARCHAR(191) NULL,
    `ssiClassification` VARCHAR(191) NULL,
    `mortality` BOOLEAN NOT NULL DEFAULT false,
    `mortalityCause` VARCHAR(191) NULL,
    `lengthOfStayDays` INTEGER NULL,
    `followUpNotes` LONGTEXT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `recordedBy` VARCHAR(191) NULL,
    `recordedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OtOutcome_scheduleId_key`(`scheduleId`),
    INDEX `OtOutcome_scheduleId_idx`(`scheduleId`),
    INDEX `OtOutcome_surgicalSiteInfection_idx`(`surgicalSiteInfection`),
    INDEX `OtOutcome_unplannedReturn_idx`(`unplannedReturn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `OtSchedule` ADD CONSTRAINT `OtSchedule_otRoomId_fkey` FOREIGN KEY (`otRoomId`) REFERENCES `OtRoom`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OtPreOpChecklist` ADD CONSTRAINT `OtPreOpChecklist_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `OtSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OtSafetyChecklist` ADD CONSTRAINT `OtSafetyChecklist_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `OtSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OtIntraOpNote` ADD CONSTRAINT `OtIntraOpNote_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `OtSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OtAnaesthesiaChart` ADD CONSTRAINT `OtAnaesthesiaChart_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `OtSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PacuRecord` ADD CONSTRAINT `PacuRecord_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `OtSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PacuVital` ADD CONSTRAINT `PacuVital_pacuRecordId_fkey` FOREIGN KEY (`pacuRecordId`) REFERENCES `PacuRecord`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OtOutcome` ADD CONSTRAINT `OtOutcome_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `OtSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
