-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `remainder1Sent` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `remainder2Sent` BOOLEAN NULL DEFAULT false;
