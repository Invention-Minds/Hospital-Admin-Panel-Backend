-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `lockExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `lockedBy` INTEGER NULL;
