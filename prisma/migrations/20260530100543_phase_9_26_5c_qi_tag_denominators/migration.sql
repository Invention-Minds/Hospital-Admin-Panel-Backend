-- AlterTable
ALTER TABLE `Incident` ADD COLUMN `qiCode` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `QualityMonthlyDenominator` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `qiCode` VARCHAR(191) NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `value` DOUBLE NOT NULL,
    `notes` TEXT NULL,
    `capturedBy` VARCHAR(191) NULL,
    `capturedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `QualityMonthlyDenominator_qiCode_idx`(`qiCode`),
    INDEX `QualityMonthlyDenominator_period_idx`(`period`),
    UNIQUE INDEX `QualityMonthlyDenominator_qiCode_period_key`(`qiCode`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Incident_qiCode_reportedAt_idx` ON `Incident`(`qiCode`, `reportedAt`);
