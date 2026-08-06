-- AlterTable
ALTER TABLE `WhatsappBotSession` ADD COLUMN `verifiedPrn` INTEGER NULL,
    ADD COLUMN `verifiedUntil` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `SecureLink` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `token` VARCHAR(191) NOT NULL,
    `prn` INTEGER NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `refId` VARCHAR(191) NULL,
    `filePath` TEXT NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL DEFAULT 'application/pdf',
    `expiresAt` DATETIME(3) NOT NULL,
    `firstUsedAt` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SecureLink_token_key`(`token`),
    INDEX `SecureLink_expiresAt_idx`(`expiresAt`),
    INDEX `SecureLink_prn_idx`(`prn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PatientRecordAccessLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prn` INTEGER NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `itemType` VARCHAR(191) NOT NULL,
    `itemRef` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL DEFAULT 'whatsapp',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PatientRecordAccessLog_prn_idx`(`prn`),
    INDEX `PatientRecordAccessLog_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsappNotificationLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prn` INTEGER NULL,
    `phone` VARCHAR(191) NOT NULL,
    `template` VARCHAR(191) NOT NULL,
    `refType` VARCHAR(191) NULL,
    `refId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WhatsappNotificationLog_template_refId_idx`(`template`, `refId`),
    INDEX `WhatsappNotificationLog_created_at_idx`(`created_at`),
    INDEX `WhatsappNotificationLog_prn_idx`(`prn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
