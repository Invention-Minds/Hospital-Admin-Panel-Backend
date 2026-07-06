-- AlterTable
ALTER TABLE `CodeActivation` ADD COLUMN `attendedAt` DATETIME(3) NULL,
    ADD COLUMN `attendedById` INTEGER NULL,
    ADD COLUMN `attendedByName` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `QualityLabRadEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventType` VARCHAR(191) NOT NULL,
    `observedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `period` VARCHAR(191) NOT NULL,
    `prn` VARCHAR(191) NULL,
    `testName` VARCHAR(191) NULL,
    `reason` TEXT NULL,
    `reporter` VARCHAR(191) NULL,
    `reporterId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `QualityLabRadEvent_eventType_period_idx`(`eventType`, `period`),
    INDEX `QualityLabRadEvent_eventType_observedAt_idx`(`eventType`, `observedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PharmacyCriticalDrug` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NULL,
    `isCritical` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PharmacyCriticalDrug_code_key`(`code`),
    INDEX `PharmacyCriticalDrug_isCritical_idx`(`isCritical`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PharmacyStockEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `drugId` VARCHAR(191) NULL,
    `drugCodeSnapshot` VARCHAR(191) NULL,
    `drugNameSnapshot` VARCHAR(191) NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `batchCode` VARCHAR(191) NULL,
    `expiryDate` DATETIME(3) NULL,
    `quantity` INTEGER NULL,
    `notes` TEXT NULL,
    `reporter` VARCHAR(191) NULL,
    `reporterId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PharmacyStockEvent_eventType_occurredAt_idx`(`eventType`, `occurredAt`),
    INDEX `PharmacyStockEvent_drugId_idx`(`drugId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PharmacyStockEvent` ADD CONSTRAINT `PharmacyStockEvent_drugId_fkey` FOREIGN KEY (`drugId`) REFERENCES `PharmacyCriticalDrug`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
