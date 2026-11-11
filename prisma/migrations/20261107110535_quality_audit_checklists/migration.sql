-- CreateTable
CREATE TABLE `AuditChecklist` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `group` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `frequency` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AuditChecklist_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditChecklistItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `checklistId` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `section` VARCHAR(191) NULL,
    `text` TEXT NOT NULL,
    `critical` BOOLEAN NOT NULL DEFAULT false,
    `qiCode` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    INDEX `AuditChecklistItem_checklistId_sortOrder_idx`(`checklistId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditRun` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `checklistId` INTEGER NOT NULL,
    `unitId` INTEGER NULL,
    `location` VARCHAR(191) NULL,
    `dueDate` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'scheduled',
    `auditorId` INTEGER NULL,
    `auditor` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `applicableCount` INTEGER NULL,
    `compliantCount` INTEGER NULL,
    `ncCount` INTEGER NULL,
    `criticalNcCount` INTEGER NULL,
    `compliancePct` DOUBLE NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AuditRun_code_key`(`code`),
    INDEX `AuditRun_status_dueDate_idx`(`status`, `dueDate`),
    INDEX `AuditRun_checklistId_unitId_completedAt_idx`(`checklistId`, `unitId`, `completedAt`),
    INDEX `AuditRun_auditorId_status_idx`(`auditorId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditRunResponse` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `itemId` INTEGER NOT NULL,
    `result` VARCHAR(191) NOT NULL,
    `remark` TEXT NULL,

    UNIQUE INDEX `AuditRunResponse_runId_itemId_key`(`runId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditFindingAction` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `itemId` INTEGER NOT NULL,
    `description` TEXT NOT NULL,
    `owner` VARCHAR(191) NULL,
    `ownerId` INTEGER NULL,
    `dueDate` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `completedAt` DATETIME(3) NULL,
    `completedBy` VARCHAR(191) NULL,
    `completionNote` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AuditFindingAction_runId_idx`(`runId`),
    INDEX `AuditFindingAction_status_dueDate_idx`(`status`, `dueDate`),
    INDEX `AuditFindingAction_ownerId_status_idx`(`ownerId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AuditChecklistItem` ADD CONSTRAINT `AuditChecklistItem_checklistId_fkey` FOREIGN KEY (`checklistId`) REFERENCES `AuditChecklist`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditRun` ADD CONSTRAINT `AuditRun_checklistId_fkey` FOREIGN KEY (`checklistId`) REFERENCES `AuditChecklist`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditRunResponse` ADD CONSTRAINT `AuditRunResponse_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `AuditRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditRunResponse` ADD CONSTRAINT `AuditRunResponse_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `AuditChecklistItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditFindingAction` ADD CONSTRAINT `AuditFindingAction_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `AuditRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
