-- AlterTable
ALTER TABLE `FeedbackSurvey` ADD COLUMN `choiceReasons` TEXT NULL,
    ADD COLUMN `collectedById` INTEGER NULL,
    ADD COLUMN `department` VARCHAR(191) NULL,
    ADD COLUMN `doctorId` INTEGER NULL,
    ADD COLUMN `doctorName` VARCHAR(191) NULL,
    ADD COLUMN `language` VARCHAR(191) NULL,
    ADD COLUMN `unitId` INTEGER NULL,
    ADD COLUMN `wardName` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `FeedbackConfig` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `satisfiedMinRating` INTEGER NOT NULL DEFAULT 4,
    `complaintMaxNps` INTEGER NOT NULL DEFAULT 6,
    `incidentMaxNps` INTEGER NOT NULL DEFAULT 3,
    `updatedById` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `FeedbackSurvey_respondedAt_department_idx` ON `FeedbackSurvey`(`respondedAt`, `department`);
