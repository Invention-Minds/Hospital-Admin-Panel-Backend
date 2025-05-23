-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `arrived` BOOLEAN NULL,
    ADD COLUMN `arrivedBy` VARCHAR(191) NULL,
    ADD COLUMN `arrivedTime` DATETIME(3) NULL,
    ADD COLUMN `blockId` VARCHAR(191) NULL;
