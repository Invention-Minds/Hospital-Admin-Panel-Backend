-- DropForeignKey
ALTER TABLE `IpdAdmission` DROP FOREIGN KEY `IpdAdmission_bedId_fkey`;

-- DropForeignKey
ALTER TABLE `IpdAdmission` DROP FOREIGN KEY `IpdAdmission_wardId_fkey`;

-- AlterTable
ALTER TABLE `IpdAdmission` MODIFY `wardId` VARCHAR(191) NULL,
    MODIFY `bedId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `IpdMedicationLog` ADD COLUMN `acknowledgedAt` DATETIME(3) NULL,
    ADD COLUMN `acknowledgedBy` VARCHAR(191) NULL,
    ADD COLUMN `acknowledgedById` INTEGER NULL,
    ADD COLUMN `acknowledgedBySignatureId` VARCHAR(191) NULL,
    ADD COLUMN `fiveRightsChecked` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `verifiedTwoIdentifiers` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `IpdDailyClosure` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `closureDate` DATETIME(3) NOT NULL,
    `doctorVisitedAt` DATETIME(3) NULL,
    `doctorVisitedBy` VARCHAR(191) NULL,
    `nursingSummary` TEXT NULL,
    `vitalsSummary` TEXT NULL,
    `satisfactionScore` INTEGER NULL,
    `concerns` TEXT NULL,
    `negativeFlag` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `attenderName` VARCHAR(191) NULL,
    `attenderRelation` VARCHAR(191) NULL,
    `attenderSignatureId` VARCHAR(191) NULL,
    `closedAt` DATETIME(3) NULL,
    `closedBy` VARCHAR(191) NULL,
    `closedById` INTEGER NULL,
    `escalationOpenedTicketId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IpdDailyClosure_closureDate_idx`(`closureDate`),
    INDEX `IpdDailyClosure_status_idx`(`status`),
    INDEX `IpdDailyClosure_negativeFlag_idx`(`negativeFlag`),
    UNIQUE INDEX `IpdDailyClosure_admissionId_closureDate_key`(`admissionId`, `closureDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `IpdAdmission` ADD CONSTRAINT `IpdAdmission_bedId_fkey` FOREIGN KEY (`bedId`) REFERENCES `IpdBed`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IpdAdmission` ADD CONSTRAINT `IpdAdmission_wardId_fkey` FOREIGN KEY (`wardId`) REFERENCES `IpdWard`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IpdDailyClosure` ADD CONSTRAINT `IpdDailyClosure_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
