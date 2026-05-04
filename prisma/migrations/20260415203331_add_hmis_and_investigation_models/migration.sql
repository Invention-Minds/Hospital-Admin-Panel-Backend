-- CreateTable
CREATE TABLE `HmisAuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `direction` VARCHAR(191) NOT NULL,
    `module` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `payload` LONGTEXT NOT NULL,
    `response` LONGTEXT NULL,
    `status` VARCHAR(191) NOT NULL,
    `retryCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `HmisAuditLog_direction_idx`(`direction`),
    INDEX `HmisAuditLog_module_idx`(`module`),
    INDEX `HmisAuditLog_status_idx`(`status`),
    INDEX `HmisAuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InvestigationResult` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `prn` VARCHAR(191) NOT NULL,
    `testName` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NOT NULL,
    `result` LONGTEXT NULL,
    `unit` VARCHAR(191) NULL,
    `referenceRange` VARCHAR(191) NULL,
    `criticalFlag` BOOLEAN NOT NULL DEFAULT false,
    `reportUrl` VARCHAR(191) NULL,
    `reportedAt` DATETIME(3) NULL,
    `hmisResultId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `InvestigationResult_prn_idx`(`prn`),
    INDEX `InvestigationResult_orderId_idx`(`orderId`),
    INDEX `InvestigationResult_status_idx`(`status`),
    INDEX `InvestigationResult_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
