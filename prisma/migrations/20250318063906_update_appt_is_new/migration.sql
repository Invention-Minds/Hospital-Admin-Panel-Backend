-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `isNew` BOOLEAN NULL,
    ADD COLUMN `prefix` VARCHAR(191) NULL;
