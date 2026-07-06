-- AlterTable
ALTER TABLE `Emergency` ADD COLUMN `oxygenDelivery` VARCHAR(191) NULL,
    ADD COLUMN `oxygenFlowRate` DOUBLE NULL;

-- AlterTable
ALTER TABLE `IpdInitialAssessment` ADD COLUMN `previousInvestigationsEnclosed` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `IpdPrescription` ADD COLUMN `site` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `EmergencyInvestigation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `emergencyId` INTEGER NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `orderedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `orderedBy` VARCHAR(191) NULL,
    `sentAt` DATETIME(3) NULL,
    `sentBy` VARCHAR(191) NULL,
    `reportedAt` DATETIME(3) NULL,
    `reportedBy` VARCHAR(191) NULL,
    `resultNotes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    INDEX `EmergencyInvestigation_emergencyId_idx`(`emergencyId`),
    INDEX `EmergencyInvestigation_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmergencyTreatment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `emergencyId` INTEGER NOT NULL,
    `drug` VARCHAR(191) NOT NULL,
    `dose` VARCHAR(191) NULL,
    `route` VARCHAR(191) NULL,
    `frequency` VARCHAR(191) NULL,
    `givenAt` DATETIME(3) NULL,
    `givenBy` VARCHAR(191) NULL,
    `signedBy` VARCHAR(191) NULL,
    `signedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    INDEX `EmergencyTreatment_emergencyId_idx`(`emergencyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmergencyProcedure` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `emergencyId` INTEGER NOT NULL,
    `procedure` VARCHAR(191) NOT NULL,
    `performedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `performedBy` VARCHAR(191) NULL,
    `signatureId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(191) NULL,

    INDEX `EmergencyProcedure_emergencyId_idx`(`emergencyId`),
    INDEX `EmergencyProcedure_procedure_idx`(`procedure`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmergencySpecimen` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `emergencyId` INTEGER NOT NULL,
    `container` VARCHAR(191) NULL,
    `amount` VARCHAR(191) NULL,
    `nurseSign` VARCHAR(191) NULL,
    `doctorSign` VARCHAR(191) NULL,
    `handedOverTo` VARCHAR(191) NULL,
    `handedOverSign` VARCHAR(191) NULL,
    `handedOverAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    INDEX `EmergencySpecimen_emergencyId_idx`(`emergencyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EmergencyInvestigation` ADD CONSTRAINT `EmergencyInvestigation_emergencyId_fkey` FOREIGN KEY (`emergencyId`) REFERENCES `Emergency`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmergencyTreatment` ADD CONSTRAINT `EmergencyTreatment_emergencyId_fkey` FOREIGN KEY (`emergencyId`) REFERENCES `Emergency`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmergencyProcedure` ADD CONSTRAINT `EmergencyProcedure_emergencyId_fkey` FOREIGN KEY (`emergencyId`) REFERENCES `Emergency`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmergencySpecimen` ADD CONSTRAINT `EmergencySpecimen_emergencyId_fkey` FOREIGN KEY (`emergencyId`) REFERENCES `Emergency`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
