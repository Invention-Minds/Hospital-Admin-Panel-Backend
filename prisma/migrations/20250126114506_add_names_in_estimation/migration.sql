-- AlterTable
ALTER TABLE `estimation_details` ADD COLUMN `approverName` VARCHAR(191) NULL,
    ADD COLUMN `cancellerId` VARCHAR(191) NULL,
    ADD COLUMN `cancellerName` VARCHAR(191) NULL,
    ADD COLUMN `employeeName` VARCHAR(191) NULL;
