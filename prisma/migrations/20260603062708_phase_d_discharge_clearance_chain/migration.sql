-- AlterTable
ALTER TABLE `IpdAdmission` ADD COLUMN `dischargeChainAbandoned` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `dischargeChainAbandonedAt` DATETIME(3) NULL,
    ADD COLUMN `dischargeChainAbandonedBy` VARCHAR(191) NULL,
    ADD COLUMN `dischargeChainAbandonedReason` TEXT NULL,
    ADD COLUMN `dischargeReadyAt` DATETIME(3) NULL,
    ADD COLUMN `dischargeReadyBy` VARCHAR(191) NULL,
    ADD COLUMN `dischargeReadyById` INTEGER NULL;

-- AlterTable
ALTER TABLE `IpdDischarge` ADD COLUMN `mtAcknowledgedAt` DATETIME(3) NULL,
    ADD COLUMN `mtAcknowledgedBy` VARCHAR(191) NULL,
    ADD COLUMN `mtAcknowledgedById` INTEGER NULL;

-- CreateTable
CREATE TABLE `DischargeClearance` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `blockingReason` TEXT NULL,
    `rejectedAt` DATETIME(3) NULL,
    `rejectedBy` VARCHAR(191) NULL,
    `rejectedById` INTEGER NULL,
    `clearedAt` DATETIME(3) NULL,
    `clearedBy` VARCHAR(191) NULL,
    `clearedById` INTEGER NULL,
    `clearedNotes` TEXT NULL,
    `clearedSignatureId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    INDEX `DischargeClearance_status_idx`(`status`),
    INDEX `DischargeClearance_department_status_idx`(`department`, `status`),
    UNIQUE INDEX `DischargeClearance_admissionId_department_key`(`admissionId`, `department`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DischargeClearance` ADD CONSTRAINT `DischargeClearance_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
