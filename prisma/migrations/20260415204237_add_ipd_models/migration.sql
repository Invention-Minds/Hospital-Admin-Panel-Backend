-- CreateTable
CREATE TABLE `IpdWard` (
    `id` VARCHAR(191) NOT NULL,
    `wardName` VARCHAR(191) NOT NULL,
    `wardCode` VARCHAR(191) NOT NULL,
    `floor` VARCHAR(191) NULL,
    `department` VARCHAR(191) NOT NULL,
    `totalBeds` INTEGER NOT NULL,
    `hmisWardId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `IpdWard_wardCode_key`(`wardCode`),
    INDEX `IpdWard_wardCode_idx`(`wardCode`),
    INDEX `IpdWard_department_idx`(`department`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IpdBed` (
    `id` VARCHAR(191) NOT NULL,
    `bedNumber` VARCHAR(191) NOT NULL,
    `wardId` VARCHAR(191) NOT NULL,
    `bedType` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'available',
    `hmisBedrId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IpdBed_wardId_idx`(`wardId`),
    INDEX `IpdBed_status_idx`(`status`),
    UNIQUE INDEX `IpdBed_wardId_bedNumber_key`(`wardId`, `bedNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IpdAdmission` (
    `id` VARCHAR(191) NOT NULL,
    `admissionNo` VARCHAR(191) NOT NULL,
    `prn` VARCHAR(191) NOT NULL,
    `admissionDate` DATETIME(3) NOT NULL,
    `admissionTime` VARCHAR(191) NOT NULL,
    `admissionType` VARCHAR(191) NOT NULL,
    `sourceModule` VARCHAR(191) NOT NULL,
    `referralOpdId` VARCHAR(191) NULL,
    `referralEmergencyId` VARCHAR(191) NULL,
    `referralMlcId` VARCHAR(191) NULL,
    `referringDoctor` VARCHAR(191) NULL,
    `admittingDoctor` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NOT NULL,
    `wardId` VARCHAR(191) NOT NULL,
    `bedId` VARCHAR(191) NOT NULL,
    `roomType` VARCHAR(191) NOT NULL,
    `diagnosis` LONGTEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'admitted',
    `hmisAdmissionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `updatedBy` VARCHAR(191) NULL,

    UNIQUE INDEX `IpdAdmission_admissionNo_key`(`admissionNo`),
    INDEX `IpdAdmission_prn_idx`(`prn`),
    INDEX `IpdAdmission_admissionNo_idx`(`admissionNo`),
    INDEX `IpdAdmission_wardId_idx`(`wardId`),
    INDEX `IpdAdmission_bedId_idx`(`bedId`),
    INDEX `IpdAdmission_status_idx`(`status`),
    INDEX `IpdAdmission_admissionDate_idx`(`admissionDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IpdProgressNote` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `doctorName` VARCHAR(191) NOT NULL,
    `subjective` LONGTEXT NOT NULL,
    `objective` LONGTEXT NOT NULL,
    `assessment` LONGTEXT NOT NULL,
    `plan` LONGTEXT NOT NULL,
    `nursingNotes` LONGTEXT NULL,
    `vitalsBP` VARCHAR(191) NULL,
    `vitalsHR` VARCHAR(191) NULL,
    `vitalsTemp` VARCHAR(191) NULL,
    `vitalsSpO2` VARCHAR(191) NULL,
    `vitalsRR` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(191) NULL,

    INDEX `IpdProgressNote_admissionId_idx`(`admissionId`),
    INDEX `IpdProgressNote_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IpdDischarge` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `dischargeDate` DATETIME(3) NOT NULL,
    `dischargeTime` VARCHAR(191) NOT NULL,
    `dischargeType` VARCHAR(191) NOT NULL,
    `finalDiagnosis` LONGTEXT NOT NULL,
    `proceduresDone` LONGTEXT NULL,
    `conditionAtDischarge` VARCHAR(191) NOT NULL,
    `dischargeSummary` LONGTEXT NOT NULL,
    `followUpDate` DATETIME(3) NULL,
    `followUpDoctor` VARCHAR(191) NULL,
    `medications` LONGTEXT NOT NULL,
    `advice` LONGTEXT NULL,
    `hmisDischargeId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(191) NULL,

    UNIQUE INDEX `IpdDischarge_admissionId_key`(`admissionId`),
    INDEX `IpdDischarge_admissionId_idx`(`admissionId`),
    INDEX `IpdDischarge_dischargeDate_idx`(`dischargeDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IpdPrescription` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `prescriptionId` VARCHAR(191) NULL,
    `prescribedBy` VARCHAR(191) NOT NULL,
    `prescribedDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `carryOverFrom` VARCHAR(191) NULL,
    `genericName` VARCHAR(191) NOT NULL,
    `brandName` VARCHAR(191) NULL,
    `dose` VARCHAR(191) NOT NULL,
    `frequency` VARCHAR(191) NOT NULL,
    `duration` VARCHAR(191) NOT NULL,
    `route` VARCHAR(191) NOT NULL DEFAULT 'oral',
    `instructions` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL,
    `isCarryOver` BOOLEAN NOT NULL DEFAULT false,
    `lastAdminTime` DATETIME(3) NULL,
    `nextAdminTime` DATETIME(3) NULL,
    `adminStatus` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `hmisRxId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `updatedBy` VARCHAR(191) NULL,

    INDEX `IpdPrescription_admissionId_idx`(`admissionId`),
    INDEX `IpdPrescription_status_idx`(`status`),
    INDEX `IpdPrescription_adminStatus_idx`(`adminStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IpdMedicationLog` (
    `id` VARCHAR(191) NOT NULL,
    `prescriptionId` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `administeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `administeredBy` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `route` VARCHAR(191) NOT NULL,
    `remarks` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IpdMedicationLog_prescriptionId_idx`(`prescriptionId`),
    INDEX `IpdMedicationLog_admissionId_idx`(`admissionId`),
    INDEX `IpdMedicationLog_administeredAt_idx`(`administeredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `IpdBed` ADD CONSTRAINT `IpdBed_wardId_fkey` FOREIGN KEY (`wardId`) REFERENCES `IpdWard`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IpdAdmission` ADD CONSTRAINT `IpdAdmission_bedId_fkey` FOREIGN KEY (`bedId`) REFERENCES `IpdBed`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IpdAdmission` ADD CONSTRAINT `IpdAdmission_wardId_fkey` FOREIGN KEY (`wardId`) REFERENCES `IpdWard`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IpdProgressNote` ADD CONSTRAINT `IpdProgressNote_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IpdDischarge` ADD CONSTRAINT `IpdDischarge_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IpdPrescription` ADD CONSTRAINT `IpdPrescription_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
