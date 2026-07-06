-- AlterTable
ALTER TABLE `HmisAuditLog` ADD COLUMN `quarantinedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `HmisDeadLetter` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `originalAuditLogId` INTEGER NOT NULL,
    `module` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(191) NOT NULL,
    `payload` LONGTEXT NOT NULL,
    `errorDetail` LONGTEXT NOT NULL,
    `retryCount` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'QUARANTINED',
    `resolvedAt` DATETIME(3) NULL,
    `resolvedBy` VARCHAR(191) NULL,
    `resolvedById` INTEGER NULL,
    `resolution` TEXT NULL,
    `movedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `HmisDeadLetter_originalAuditLogId_key`(`originalAuditLogId`),
    INDEX `HmisDeadLetter_status_idx`(`status`),
    INDEX `HmisDeadLetter_module_idx`(`module`),
    INDEX `HmisDeadLetter_movedAt_idx`(`movedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NabhAuditExport` (
    `id` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(191) NOT NULL,
    `fromDate` DATETIME(3) NOT NULL,
    `toDate` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'QUEUED',
    `filePath` VARCHAR(191) NULL,
    `downloadUrl` VARCHAR(191) NULL,
    `rowCount` INTEGER NULL,
    `bundleBytes` INTEGER NULL,
    `errorDetail` LONGTEXT NULL,
    `requestedBy` VARCHAR(191) NULL,
    `requestedById` INTEGER NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,

    INDEX `NabhAuditExport_status_idx`(`status`),
    INDEX `NabhAuditExport_scope_idx`(`scope`),
    INDEX `NabhAuditExport_requestedAt_idx`(`requestedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HmisConflict` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `module` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `fieldName` VARCHAR(191) NOT NULL,
    `localValue` LONGTEXT NULL,
    `hmisValue` LONGTEXT NULL,
    `detectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `resolution` TEXT NULL,
    `resolvedAt` DATETIME(3) NULL,
    `resolvedBy` VARCHAR(191) NULL,
    `resolvedById` INTEGER NULL,
    `triggerAuditLogId` INTEGER NULL,

    INDEX `HmisConflict_status_idx`(`status`),
    INDEX `HmisConflict_module_idx`(`module`),
    INDEX `HmisConflict_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `HmisConflict_detectedAt_idx`(`detectedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
