-- CreateTable
CREATE TABLE `Emergency` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prn` VARCHAR(191) NOT NULL,
    `appointmentId` INTEGER NULL,
    `patientName` VARCHAR(191) NOT NULL,
    `phoneNumber` VARCHAR(191) NULL,
    `age` INTEGER NULL,
    `gender` VARCHAR(191) NULL,
    `triageCategory` VARCHAR(191) NOT NULL,
    `presentingComplaint` LONGTEXT NOT NULL,
    `abcdeAssessment` LONGTEXT NOT NULL,
    `traumaScore` INTEGER NULL,
    `vitalsBP` VARCHAR(191) NULL,
    `vitalsHR` INTEGER NULL,
    `vitalsRR` INTEGER NULL,
    `vitalsSpO2` INTEGER NULL,
    `vitalsTemp` DOUBLE NULL,
    `proceduresDone` LONGTEXT NULL,
    `status` VARCHAR(191) NOT NULL,
    `docmindsCreated` BOOLEAN NOT NULL DEFAULT true,
    `hmisCreated` BOOLEAN NOT NULL DEFAULT false,
    `hmisEmergencyId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `updatedBy` VARCHAR(191) NULL,

    UNIQUE INDEX `Emergency_prn_key`(`prn`),
    INDEX `Emergency_prn_idx`(`prn`),
    INDEX `Emergency_status_idx`(`status`),
    INDEX `Emergency_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmergencyProgressNote` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `emergencyId` INTEGER NOT NULL,
    `time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `doctorName` VARCHAR(191) NOT NULL,
    `observation` LONGTEXT NOT NULL,
    `vitalsBP` VARCHAR(191) NULL,
    `vitalsHR` INTEGER NULL,
    `vitalsRR` INTEGER NULL,
    `vitalsSpO2` INTEGER NULL,
    `vitalsTemp` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(191) NULL,

    INDEX `EmergencyProgressNote_emergencyId_idx`(`emergencyId`),
    INDEX `EmergencyProgressNote_time_idx`(`time`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MlcCase` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `emergencyId` INTEGER NOT NULL,
    `mlcNo` VARCHAR(191) NOT NULL,
    `caseType` VARCHAR(191) NOT NULL,
    `policeStationName` VARCHAR(191) NULL,
    `fir_No` VARCHAR(191) NULL,
    `fir_Date` DATETIME(3) NULL,
    `investigatingOfficer` VARCHAR(191) NULL,
    `patientConsent` BOOLEAN NOT NULL,
    `consentTime` DATETIME(3) NULL,
    `consentSignature` VARCHAR(191) NULL,
    `firstExaminationDone` BOOLEAN NOT NULL,
    `firstExaminationTime` DATETIME(3) NULL,
    `examinerName` VARCHAR(191) NULL,
    `examinerSignature` VARCHAR(191) NULL,
    `injuries` LONGTEXT NOT NULL,
    `photographsTaken` BOOLEAN NOT NULL,
    `photoUrls` TEXT NULL,
    `samplesCollected` VARCHAR(191) NULL,
    `sampleStorageInfo` LONGTEXT NULL,
    `followUpExams` LONGTEXT NULL,
    `finalReport` LONGTEXT NULL,
    `reportSubmittedTo` VARCHAR(191) NULL,
    `submissionDate` DATETIME(3) NULL,
    `submissionProof` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `updatedBy` VARCHAR(191) NULL,

    UNIQUE INDEX `MlcCase_emergencyId_key`(`emergencyId`),
    UNIQUE INDEX `MlcCase_mlcNo_key`(`mlcNo`),
    INDEX `MlcCase_mlcNo_idx`(`mlcNo`),
    INDEX `MlcCase_status_idx`(`status`),
    INDEX `MlcCase_emergencyId_idx`(`emergencyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LamaRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `emergencyId` INTEGER NOT NULL,
    `lamaTime` DATETIME(3) NOT NULL,
    `doctorAdvice` LONGTEXT NOT NULL,
    `riskExplained` BOOLEAN NOT NULL,
    `patientSignature` VARCHAR(191) NULL,
    `witnessName` VARCHAR(191) NULL,
    `witnessSignature` VARCHAR(191) NULL,
    `reasonForLama` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(191) NULL,

    UNIQUE INDEX `LamaRecord_emergencyId_key`(`emergencyId`),
    INDEX `LamaRecord_emergencyId_idx`(`emergencyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DamaRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `emergencyId` INTEGER NOT NULL,
    `dischargeTime` DATETIME(3) NOT NULL,
    `doctorRecommendation` LONGTEXT NOT NULL,
    `patientDeclinesAdvice` BOOLEAN NOT NULL,
    `patientSignature` VARCHAR(191) NULL,
    `witnessName` VARCHAR(191) NULL,
    `witnessSignature` VARCHAR(191) NULL,
    `followUpAdvice` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(191) NULL,

    UNIQUE INDEX `DamaRecord_emergencyId_key`(`emergencyId`),
    INDEX `DamaRecord_emergencyId_idx`(`emergencyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EmergencyProgressNote` ADD CONSTRAINT `EmergencyProgressNote_emergencyId_fkey` FOREIGN KEY (`emergencyId`) REFERENCES `Emergency`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MlcCase` ADD CONSTRAINT `MlcCase_emergencyId_fkey` FOREIGN KEY (`emergencyId`) REFERENCES `Emergency`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LamaRecord` ADD CONSTRAINT `LamaRecord_emergencyId_fkey` FOREIGN KEY (`emergencyId`) REFERENCES `Emergency`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DamaRecord` ADD CONSTRAINT `DamaRecord_emergencyId_fkey` FOREIGN KEY (`emergencyId`) REFERENCES `Emergency`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
