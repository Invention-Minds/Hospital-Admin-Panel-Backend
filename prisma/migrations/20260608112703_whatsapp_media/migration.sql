-- AlterTable
ALTER TABLE `WhatsappQueryMessage` ADD COLUMN `fileName` VARCHAR(191) NULL,
    ADD COLUMN `mediaMime` VARCHAR(191) NULL,
    ADD COLUMN `mediaType` VARCHAR(191) NULL,
    ADD COLUMN `mediaUrl` VARCHAR(191) NULL;
