-- CreateTable
CREATE TABLE `QualityConfig` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `submissionDueDay` INTEGER NOT NULL DEFAULT 8,
    `updatedById` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QualityQiReminder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `period` VARCHAR(191) NOT NULL,
    `stage` VARCHAR(191) NOT NULL,
    `missing` INTEGER NOT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `QualityQiReminder_period_stage_key`(`period`, `stage`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
