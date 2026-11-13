-- AlterTable
ALTER TABLE `DietCensusLine` ADD COLUMN `foodAllergy` TEXT NULL,
    ADD COLUMN `foodPreference` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `DietPlan` ADD COLUMN `doctorAckAt` DATETIME(3) NULL,
    ADD COLUMN `doctorAckBy` VARCHAR(191) NULL,
    ADD COLUMN `doctorAckNote` TEXT NULL,
    ADD COLUMN `endReason` VARCHAR(191) NULL,
    ADD COLUMN `feedStartTime` VARCHAR(191) NULL,
    ADD COLUMN `feedWindowFrom` VARCHAR(191) NULL,
    ADD COLUMN `feedWindowUntil` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `MealOrder` ADD COLUMN `choiceTakenAt` DATETIME(3) NULL,
    ADD COLUMN `choiceTakenBy` VARCHAR(191) NULL,
    ADD COLUMN `receivedAt` DATETIME(3) NULL,
    ADD COLUMN `receivedBy` VARCHAR(191) NULL,
    ADD COLUMN `receivedByName` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `MenuOption` (
    `id` VARCHAR(191) NOT NULL,
    `dietMasterId` VARCHAR(191) NOT NULL,
    `mealTimeSlotId` VARCHAR(191) NOT NULL,
    `dayOfWeek` INTEGER NOT NULL,
    `mealMasterId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MenuOption_dietMasterId_mealTimeSlotId_dayOfWeek_idx`(`dietMasterId`, `mealTimeSlotId`, `dayOfWeek`),
    UNIQUE INDEX `MenuOption_dietMasterId_mealTimeSlotId_dayOfWeek_mealMasterI_key`(`dietMasterId`, `mealTimeSlotId`, `dayOfWeek`, `mealMasterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeedDose` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `dietPlanId` VARCHAR(191) NOT NULL,
    `scheduledFor` DATETIME(3) NOT NULL,
    `volumeMl` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ORDERED',
    `preparedAt` DATETIME(3) NULL,
    `preparedBy` VARCHAR(191) NULL,
    `givenAt` DATETIME(3) NULL,
    `givenBy` VARCHAR(191) NULL,
    `givenByName` VARCHAR(191) NULL,
    `skipReason` TEXT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FeedDose_scheduledFor_status_idx`(`scheduledFor`, `status`),
    INDEX `FeedDose_dietPlanId_idx`(`dietPlanId`),
    UNIQUE INDEX `FeedDose_admissionId_scheduledFor_key`(`admissionId`, `scheduledFor`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FoodQualityCheck` (
    `id` VARCHAR(191) NOT NULL,
    `checkDate` DATETIME(3) NOT NULL,
    `mealTimeSlotId` VARCHAR(191) NULL,
    `dietMasterId` VARCHAR(191) NULL,
    `item` VARCHAR(191) NULL,
    `ratings` TEXT NOT NULL,
    `totalScore` INTEGER NOT NULL,
    `ratedCount` INTEGER NOT NULL,
    `grade` VARCHAR(191) NOT NULL,
    `observations` TEXT NULL,
    `correctiveAction` TEXT NULL,
    `checkedBy` VARCHAR(191) NULL,
    `checkedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FoodQualityCheck_checkDate_idx`(`checkDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DietFeedback` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `feedbackDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ratings` TEXT NOT NULL,
    `averageScore` DOUBLE NOT NULL,
    `correctDiet` BOOLEAN NULL,
    `comments` TEXT NULL,
    `respondent` VARCHAR(191) NOT NULL DEFAULT 'PATIENT',
    `respondentName` VARCHAR(191) NULL,
    `signatureId` VARCHAR(191) NULL,
    `staffName` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DietFeedback_admissionId_idx`(`admissionId`),
    INDEX `DietFeedback_feedbackDate_idx`(`feedbackDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MenuOption` ADD CONSTRAINT `MenuOption_mealMasterId_fkey` FOREIGN KEY (`mealMasterId`) REFERENCES `MealMaster`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedDose` ADD CONSTRAINT `FeedDose_dietPlanId_fkey` FOREIGN KEY (`dietPlanId`) REFERENCES `DietPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
