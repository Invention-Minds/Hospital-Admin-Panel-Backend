-- AlterTable
ALTER TABLE `Incident` ADD COLUMN `harmLevel` VARCHAR(191) NULL,
    ADD COLUMN `harmLevelFinal` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `IncidentCapaAction` (
    `id` VARCHAR(191) NOT NULL,
    `incidentId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
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

    INDEX `IncidentCapaAction_incidentId_idx`(`incidentId`),
    INDEX `IncidentCapaAction_status_dueDate_idx`(`status`, `dueDate`),
    INDEX `IncidentCapaAction_ownerId_status_idx`(`ownerId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IncidentEffectivenessReview` (
    `id` VARCHAR(191) NOT NULL,
    `incidentId` VARCHAR(191) NOT NULL,
    `dayOffset` INTEGER NOT NULL,
    `dueAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `outcome` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `reviewedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IncidentEffectivenessReview_incidentId_idx`(`incidentId`),
    INDEX `IncidentEffectivenessReview_status_dueAt_idx`(`status`, `dueAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `IncidentCapaAction` ADD CONSTRAINT `IncidentCapaAction_incidentId_fkey` FOREIGN KEY (`incidentId`) REFERENCES `Incident`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IncidentEffectivenessReview` ADD CONSTRAINT `IncidentEffectivenessReview_incidentId_fkey` FOREIGN KEY (`incidentId`) REFERENCES `Incident`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
