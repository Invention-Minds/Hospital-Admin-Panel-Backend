-- AlterTable
ALTER TABLE `Doctor` ADD COLUMN `updatedBy` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `updatedBy` VARCHAR(191) NULL;
