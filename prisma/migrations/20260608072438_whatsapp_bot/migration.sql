-- CreateTable
CREATE TABLE `WhatsappBotSession` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `phone` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL DEFAULT 'AWAITING_PRN',
    `prn` INTEGER NULL,
    `doctorId` INTEGER NULL,
    `doctorName` VARCHAR(191) NULL,
    `activeQueryId` INTEGER NULL,
    `lastInboundAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WhatsappBotSession_phone_key`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsappQuery` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `refNo` VARCHAR(191) NOT NULL,
    `patientPhone` VARCHAR(191) NOT NULL,
    `prn` INTEGER NOT NULL,
    `patientName` VARCHAR(191) NULL,
    `doctorId` INTEGER NOT NULL,
    `doctorName` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `lastPatientMsgAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WhatsappQuery_refNo_key`(`refNo`),
    INDEX `WhatsappQuery_doctorId_status_idx`(`doctorId`, `status`),
    INDEX `WhatsappQuery_patientPhone_idx`(`patientPhone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsappQueryMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `queryId` INTEGER NOT NULL,
    `direction` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `sender` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WhatsappQueryMessage_queryId_idx`(`queryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WhatsappQueryMessage` ADD CONSTRAINT `WhatsappQueryMessage_queryId_fkey` FOREIGN KEY (`queryId`) REFERENCES `WhatsappQuery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
