-- AlterTable
ALTER TABLE `Package` ADD COLUMN `radioIds` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Service` ADD COLUMN `boneDensitometryEntryTime` DATETIME(3) NULL,
    ADD COLUMN `chestXRayEntryTime` DATETIME(3) NULL,
    ADD COLUMN `ecgEntryTime` DATETIME(3) NULL,
    ADD COLUMN `echoTMTEntryTime` DATETIME(3) NULL,
    ADD COLUMN `isLabEntryTime` DATETIME(3) NULL,
    ADD COLUMN `mammographyEntryTime` DATETIME(3) NULL,
    ADD COLUMN `radioServiceId` INTEGER NULL,
    ADD COLUMN `ultrasoundEntryTime` DATETIME(3) NULL,
    ADD COLUMN `usgEchoEntryTime` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `RadioService` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Service` ADD CONSTRAINT `Service_radioServiceId_fkey` FOREIGN KEY (`radioServiceId`) REFERENCES `RadioService`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
