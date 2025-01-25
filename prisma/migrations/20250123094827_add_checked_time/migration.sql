-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `checkedInTime` DATETIME(3) NULL,
    ADD COLUMN `checkedOutTime` DATETIME(3) NULL,
    ADD COLUMN `waitingTime` VARCHAR(191) NULL;
