-- CreateTable
CREATE TABLE `QualityTatEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `qiCode` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `endedAt` DATETIME(3) NOT NULL,
    `durationMinutes` INTEGER NOT NULL,
    `withinTarget` BOOLEAN NULL,
    `location` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `capturedBy` VARCHAR(191) NULL,
    `capturedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `QualityTatEvent_qiCode_startedAt_idx`(`qiCode`, `startedAt`),
    INDEX `QualityTatEvent_qiCode_withinTarget_idx`(`qiCode`, `withinTarget`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
