-- AlterTable
ALTER TABLE `Package` ADD COLUMN `deptIds` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Service` ADD COLUMN `checkedInTime` DATETIME(3) NULL;
