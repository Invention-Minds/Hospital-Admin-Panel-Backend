-- CreateTable
CREATE TABLE `QualityIndicator` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `qiCode` VARCHAR(191) NOT NULL,
    `chapter` VARCHAR(191) NOT NULL,
    `nabhRef` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `indicatorType` VARCHAR(191) NOT NULL,
    `numeratorDef` TEXT NOT NULL,
    `denominatorDef` TEXT NOT NULL,
    `multiplier` VARCHAR(191) NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `frequency` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(191) NOT NULL,
    `defaultBenchmark` DOUBLE NULL,
    `amberThresholdPct` DOUBLE NOT NULL DEFAULT 80,
    `isCritical` BOOLEAN NOT NULL DEFAULT false,
    `criticalRule` TEXT NULL,
    `dataCaptureFields` TEXT NULL,
    `escalationOwner` VARCHAR(191) NOT NULL,
    `rcaRequiredRule` VARCHAR(191) NOT NULL,
    `nabhClause` VARCHAR(191) NULL,
    `sourceUrl` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `QualityIndicator_qiCode_key`(`qiCode`),
    INDEX `QualityIndicator_chapter_idx`(`chapter`),
    INDEX `QualityIndicator_department_idx`(`department`),
    INDEX `QualityIndicator_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QualityIndicatorRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `indicatorId` INTEGER NOT NULL,
    `qiCode` VARCHAR(191) NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `numerator` DOUBLE NOT NULL,
    `denominator` DOUBLE NOT NULL,
    `calculatedValue` DOUBLE NOT NULL,
    `benchmarkUsed` DOUBLE NULL,
    `status` VARCHAR(191) NOT NULL,
    `severity` VARCHAR(191) NOT NULL,
    `autoCalculated` BOOLEAN NOT NULL DEFAULT false,
    `capturedBy` VARCHAR(191) NULL,
    `capturedById` INTEGER NULL,
    `remarks` TEXT NULL,
    `evidenceLinks` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `QualityIndicatorRecord_qiCode_period_idx`(`qiCode`, `period`),
    INDEX `QualityIndicatorRecord_status_idx`(`status`),
    INDEX `QualityIndicatorRecord_periodStart_idx`(`periodStart`),
    UNIQUE INDEX `QualityIndicatorRecord_indicatorId_period_key`(`indicatorId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QualityIndicatorRca` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `recordId` INTEGER NOT NULL,
    `immediateActions` LONGTEXT NULL,
    `why1` TEXT NULL,
    `why2` TEXT NULL,
    `why3` TEXT NULL,
    `why4` TEXT NULL,
    `why5` TEXT NULL,
    `rootCause` TEXT NULL,
    `correctiveActions` LONGTEXT NULL,
    `preventiveActions` LONGTEXT NULL,
    `owner` VARCHAR(191) NULL,
    `ownerId` INTEGER NULL,
    `dueDate` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `effectivenessReview` LONGTEXT NULL,
    `effectivenessReviewAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `QualityIndicatorRca_recordId_key`(`recordId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `QualityIndicatorRecord` ADD CONSTRAINT `QualityIndicatorRecord_indicatorId_fkey` FOREIGN KEY (`indicatorId`) REFERENCES `QualityIndicator`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QualityIndicatorRca` ADD CONSTRAINT `QualityIndicatorRca_recordId_fkey` FOREIGN KEY (`recordId`) REFERENCES `QualityIndicatorRecord`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
