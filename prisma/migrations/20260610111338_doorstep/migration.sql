-- AlterTable
ALTER TABLE `WhatsappBotSession` ADD COLUMN `consentAt` DATETIME(3) NULL,
    ADD COLUMN `flow` VARCHAR(191) NULL,
    ADD COLUMN `otpCode` VARCHAR(191) NULL,
    ADD COLUMN `otpExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `scratch` TEXT NULL;

-- CreateTable
CREATE TABLE `DoorstepRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `refNo` VARCHAR(191) NOT NULL,
    `patientPhone` VARCHAR(191) NOT NULL,
    `prn` INTEGER NULL,
    `patientName` VARCHAR(191) NOT NULL,
    `serviceType` VARCHAR(191) NOT NULL,
    `address` TEXT NOT NULL,
    `details` TEXT NULL,
    `lat` DOUBLE NULL,
    `lng` DOUBLE NULL,
    `distanceKm` DOUBLE NULL,
    `withinFreeRadius` BOOLEAN NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `consentAt` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DoorstepRequest_refNo_key`(`refNo`),
    INDEX `DoorstepRequest_status_idx`(`status`),
    INDEX `DoorstepRequest_patientPhone_idx`(`patientPhone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
