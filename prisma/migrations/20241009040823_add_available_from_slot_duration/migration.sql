-- AlterTable
ALTER TABLE `doctor` ADD COLUMN `availableFrom` VARCHAR(191) NULL,
    ADD COLUMN `slotDuration` INTEGER NULL;
