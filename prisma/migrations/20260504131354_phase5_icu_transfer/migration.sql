-- CreateTable
CREATE TABLE `IpdIcuTransferRequest` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `fromWardId` VARCHAR(191) NULL,
    `fromBedId` VARCHAR(191) NULL,
    `toWardId` VARCHAR(191) NULL,
    `toBedId` VARCHAR(191) NULL,
    `rationale` TEXT NOT NULL,
    `vitalsSnapshot` TEXT NULL,
    `linesAndDrains` TEXT NULL,
    `codeStatus` VARCHAR(191) NULL,
    `sedationPlan` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PROPOSED',
    `proposedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `proposedBy` VARCHAR(191) NULL,
    `proposedById` INTEGER NULL,
    `proposerName` VARCHAR(191) NULL,
    `proposerSignatureId` VARCHAR(191) NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `acknowledgedBy` VARCHAR(191) NULL,
    `acknowledgedById` INTEGER NULL,
    `intensivistName` VARCHAR(191) NULL,
    `intensivistSignatureId` VARCHAR(191) NULL,
    `declineReason` TEXT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `acceptedBy` VARCHAR(191) NULL,
    `acceptedById` INTEGER NULL,
    `receiverSignatureId` VARCHAR(191) NULL,
    `inTransitAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `handoverSignatureId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IpdIcuTransferRequest_admissionId_idx`(`admissionId`),
    INDEX `IpdIcuTransferRequest_status_idx`(`status`),
    INDEX `IpdIcuTransferRequest_proposedAt_idx`(`proposedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `IpdIcuTransferRequest` ADD CONSTRAINT `IpdIcuTransferRequest_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
