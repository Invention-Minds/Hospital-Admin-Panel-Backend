-- AlterTable
ALTER TABLE `Doctor` ADD COLUMN `signUrl` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `ERAssessment` ADD COLUMN `createdBy` INTEGER NULL;

-- AlterTable
ALTER TABLE `OPDAssessment` ADD COLUMN `createdBy` INTEGER NULL;
