-- AlterTable
ALTER TABLE `ot_details` ADD COLUMN `coordinatorId` VARCHAR(191) NULL,
    ADD COLUMN `paid` BOOLEAN NULL DEFAULT false;
