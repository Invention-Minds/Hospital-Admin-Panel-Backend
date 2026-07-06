-- CreateTable
CREATE TABLE `QualityAuditObservation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `qiCode` VARCHAR(191) NOT NULL,
    `observedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `period` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NULL,
    `checkpointKey` VARCHAR(191) NULL,
    `checkpointLabel` VARCHAR(191) NULL,
    `compliant` BOOLEAN NOT NULL,
    `notes` TEXT NULL,
    `auditor` VARCHAR(191) NULL,
    `auditorId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `QualityAuditObservation_qiCode_period_idx`(`qiCode`, `period`),
    INDEX `QualityAuditObservation_qiCode_observedAt_idx`(`qiCode`, `observedAt`),
    INDEX `QualityAuditObservation_auditorId_idx`(`auditorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
