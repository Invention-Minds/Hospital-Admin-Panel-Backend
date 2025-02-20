-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `checkedInBy` VARCHAR(191) NULL,
    ADD COLUMN `extraWaitingTime` INTEGER NULL;
