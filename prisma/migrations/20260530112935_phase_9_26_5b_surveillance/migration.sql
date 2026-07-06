-- CreateTable
CREATE TABLE `QualitySurveillanceEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(191) NOT NULL,
    `patientPrn` VARCHAR(191) NULL,
    `admissionId` VARCHAR(191) NULL,
    `ward` VARCHAR(191) NULL,
    `organism` VARCHAR(191) NULL,
    `deviceRelated` BOOLEAN NOT NULL DEFAULT false,
    `observedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `period` VARCHAR(191) NOT NULL,
    `notes` TEXT NULL,
    `reporter` VARCHAR(191) NULL,
    `reporterId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `QualitySurveillanceEvent_type_period_idx`(`type`, `period`),
    INDEX `QualitySurveillanceEvent_type_observedAt_idx`(`type`, `observedAt`),
    INDEX `QualitySurveillanceEvent_ward_idx`(`ward`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QualityDeviceDayCount` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NOT NULL,
    `ward` VARCHAR(191) NOT NULL,
    `deviceType` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL,
    `capturedBy` VARCHAR(191) NULL,
    `capturedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `QualityDeviceDayCount_date_idx`(`date`),
    INDEX `QualityDeviceDayCount_deviceType_idx`(`deviceType`),
    UNIQUE INDEX `QualityDeviceDayCount_date_ward_deviceType_key`(`date`, `ward`, `deviceType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QualitySterilizationCycle` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `batchCode` VARCHAR(191) NULL,
    `runAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `passed` BOOLEAN NOT NULL,
    `failureReason` TEXT NULL,
    `capturedBy` VARCHAR(191) NULL,
    `capturedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `QualitySterilizationCycle_runAt_idx`(`runAt`),
    INDEX `QualitySterilizationCycle_passed_idx`(`passed`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
