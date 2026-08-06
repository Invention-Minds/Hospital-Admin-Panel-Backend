-- CreateTable
CREATE TABLE `OphthalmologyPrescription` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prescriptionId` VARCHAR(191) NOT NULL,
    `appointmentId` INTEGER NULL,
    `doctorId` INTEGER NULL,
    `prn` INTEGER NOT NULL,
    `opdPrescriptionId` VARCHAR(191) NULL,
    `patientName` VARCHAR(191) NOT NULL,
    `patientAge` VARCHAR(191) NULL,
    `patientGender` VARCHAR(191) NULL,
    `uaVr` TEXT NULL,
    `uaVl` TEXT NULL,
    `glVr` TEXT NULL,
    `glVl` TEXT NULL,
    `nearVr` TEXT NULL,
    `nearVl` TEXT NULL,
    `curSphR` TEXT NULL,
    `curCylR` TEXT NULL,
    `curAxisR` TEXT NULL,
    `curVAR` TEXT NULL,
    `curSphL` TEXT NULL,
    `curCylL` TEXT NULL,
    `curAxisL` TEXT NULL,
    `curVAL` TEXT NULL,
    `curAdd` TEXT NULL,
    `curIPD` TEXT NULL,
    `curType` TEXT NULL,
    `curAddSphR` TEXT NULL,
    `curAddCylR` TEXT NULL,
    `curAddAxisR` TEXT NULL,
    `curAddVAR` TEXT NULL,
    `curAddSphL` TEXT NULL,
    `curAddCylL` TEXT NULL,
    `curAddAxisL` TEXT NULL,
    `curAddVAL` TEXT NULL,
    `arSphR` TEXT NULL,
    `arCylR` TEXT NULL,
    `arAxisR` TEXT NULL,
    `arVAR` TEXT NULL,
    `arSphL` TEXT NULL,
    `arCylL` TEXT NULL,
    `arAxisL` TEXT NULL,
    `arVAL` TEXT NULL,
    `arIPD` TEXT NULL,
    `srSphR` TEXT NULL,
    `srCylR` TEXT NULL,
    `srAxisR` TEXT NULL,
    `srVAR` TEXT NULL,
    `srSphL` TEXT NULL,
    `srCylL` TEXT NULL,
    `srAxisL` TEXT NULL,
    `srVAL` TEXT NULL,
    `srIPD` TEXT NULL,
    `srType` TEXT NULL,
    `srAddSphR` TEXT NULL,
    `srAddCylR` TEXT NULL,
    `srAddAxisR` TEXT NULL,
    `srAddVAR` TEXT NULL,
    `srAddSphL` TEXT NULL,
    `srAddCylL` TEXT NULL,
    `srAddAxisL` TEXT NULL,
    `srAddVAL` TEXT NULL,
    `iopR` TEXT NULL,
    `iopL` TEXT NULL,
    `includeIOP` BOOLEAN NULL DEFAULT false,
    `eyelidsR` TEXT NULL,
    `eyelidsL` TEXT NULL,
    `eomR` TEXT NULL,
    `eomL` TEXT NULL,
    `corneaR` TEXT NULL,
    `corneaL` TEXT NULL,
    `anteriorChR` TEXT NULL,
    `anteriorChL` TEXT NULL,
    `conjunctivaR` TEXT NULL,
    `conjunctivaL` TEXT NULL,
    `scleraR` TEXT NULL,
    `scleraL` TEXT NULL,
    `irisR` TEXT NULL,
    `irisL` TEXT NULL,
    `pupilR` TEXT NULL,
    `pupilL` TEXT NULL,
    `lensR` TEXT NULL,
    `lensL` TEXT NULL,
    `fundusR` TEXT NULL,
    `fundusL` TEXT NULL,
    `pupilReactionR` TEXT NULL,
    `pupilReactionL` TEXT NULL,
    `diagnosis` TEXT NULL,
    `diagnosisList` LONGTEXT NULL,
    `advice` TEXT NULL,
    `reviewAfter` TEXT NULL,
    `vfData` LONGTEXT NULL,
    `eomData` LONGTEXT NULL,
    `gonioData` LONGTEXT NULL,
    `diagramImage` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OphthalmologyPrescription_prescriptionId_key`(`prescriptionId`),
    INDEX `OphthalmologyPrescription_doctorId_idx`(`doctorId`),
    INDEX `OphthalmologyPrescription_appointmentId_idx`(`appointmentId`),
    INDEX `OphthalmologyPrescription_opdPrescriptionId_idx`(`opdPrescriptionId`),
    INDEX `OphthalmologyPrescription_prn_idx`(`prn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OphthalmologyExaminationOption` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fieldName` VARCHAR(191) NOT NULL,
    `optionLabel` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OphthalmologyExaminationOption_fieldName_idx`(`fieldName`),
    INDEX `OphthalmologyExaminationOption_departmentId_idx`(`departmentId`),
    INDEX `OphthalmologyExaminationOption_createdBy_idx`(`createdBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OphthalmologyDiagramMark` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prescriptionId` VARCHAR(191) NOT NULL,
    `diagram` VARCHAR(191) NOT NULL,
    `eye` VARCHAR(191) NOT NULL,
    `x` DOUBLE NOT NULL,
    `y` DOUBLE NOT NULL,
    `size` INTEGER NOT NULL,
    `color` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OphthalmologyDiagramMark_prescriptionId_idx`(`prescriptionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `OphthalmologyPrescription` ADD CONSTRAINT `OphthalmologyPrescription_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OphthalmologyPrescription` ADD CONSTRAINT `OphthalmologyPrescription_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `appointments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OphthalmologyPrescription` ADD CONSTRAINT `OphthalmologyPrescription_opdPrescriptionId_fkey` FOREIGN KEY (`opdPrescriptionId`) REFERENCES `Prescription`(`prescriptionId`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OphthalmologyExaminationOption` ADD CONSTRAINT `OphthalmologyExaminationOption_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OphthalmologyExaminationOption` ADD CONSTRAINT `OphthalmologyExaminationOption_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `Doctor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OphthalmologyDiagramMark` ADD CONSTRAINT `OphthalmologyDiagramMark_prescriptionId_fkey` FOREIGN KEY (`prescriptionId`) REFERENCES `OphthalmologyPrescription`(`prescriptionId`) ON DELETE CASCADE ON UPDATE CASCADE;
