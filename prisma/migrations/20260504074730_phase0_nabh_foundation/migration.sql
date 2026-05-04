-- CreateTable
CREATE TABLE `AppAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `module` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NULL,
    `entityId` VARCHAR(191) NULL,
    `payload` LONGTEXT NULL,
    `notes` TEXT NULL,
    `actorId` INTEGER NULL,
    `actorName` VARCHAR(191) NULL,
    `actorRole` VARCHAR(191) NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AppAuditLog_module_action_idx`(`module`, `action`),
    INDEX `AppAuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `AppAuditLog_actorId_idx`(`actorId`),
    INDEX `AppAuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SignatureBlob` (
    `id` VARCHAR(191) NOT NULL,
    `blobUrl` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL DEFAULT 'image/png',
    `signerType` VARCHAR(191) NOT NULL,
    `signerId` INTEGER NULL,
    `signerName` VARCHAR(191) NOT NULL,
    `signerRole` VARCHAR(191) NULL,
    `signerRelation` VARCHAR(191) NULL,
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deviceFingerprint` VARCHAR(191) NULL,
    `ipAddress` VARCHAR(191) NULL,
    `sha256Hash` VARCHAR(191) NULL,
    `contextType` VARCHAR(191) NULL,
    `contextId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SignatureBlob_signerType_signerId_idx`(`signerType`, `signerId`),
    INDEX `SignatureBlob_contextType_contextId_idx`(`contextType`, `contextId`),
    INDEX `SignatureBlob_capturedAt_idx`(`capturedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeatureFlag` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `flagKey` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `rolloutScope` VARCHAR(191) NOT NULL DEFAULT 'global',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedById` INTEGER NULL,
    `updatedBy` VARCHAR(191) NULL,

    UNIQUE INDEX `FeatureFlag_flagKey_key`(`flagKey`),
    INDEX `FeatureFlag_flagKey_idx`(`flagKey`),
    INDEX `FeatureFlag_enabled_idx`(`enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
