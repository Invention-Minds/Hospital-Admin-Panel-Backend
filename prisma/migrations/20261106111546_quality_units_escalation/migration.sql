-- AlterTable
ALTER TABLE `Complaint` ADD COLUMN `escalationLevel` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `escalationStartAt` DATETIME(3) NULL,
    ADD COLUMN `lastEscalatedAt` DATETIME(3) NULL,
    ADD COLUMN `unitId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Incident` ADD COLUMN `escalationLevel` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `escalationStartAt` DATETIME(3) NULL,
    ADD COLUMN `lastEscalatedAt` DATETIME(3) NULL,
    ADD COLUMN `unitId` INTEGER NULL;

-- CreateTable
CREATE TABLE `HospitalUnit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `hodUserId` INTEGER NULL,
    `deputyUserId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `HospitalUnit_name_key`(`name`),
    INDEX `HospitalUnit_hodUserId_idx`(`hodUserId`),
    INDEX `HospitalUnit_deputyUserId_idx`(`deputyUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HospitalUnitMapping` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `unitId` INTEGER NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,

    INDEX `HospitalUnitMapping_unitId_idx`(`unitId`),
    UNIQUE INDEX `HospitalUnitMapping_kind_value_key`(`kind`, `value`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QualityEscalationRule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `module` VARCHAR(191) NOT NULL,
    `severity` VARCHAR(191) NOT NULL,
    `level` INTEGER NOT NULL,
    `afterMinutes` INTEGER NOT NULL,
    `targets` TEXT NOT NULL,
    `label` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `QualityEscalationRule_module_severity_level_key`(`module`, `severity`, `level`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Complaint_unitId_idx` ON `Complaint`(`unitId`);

-- CreateIndex
CREATE INDEX `Complaint_escalationStartAt_status_idx` ON `Complaint`(`escalationStartAt`, `status`);

-- CreateIndex
CREATE INDEX `Incident_unitId_idx` ON `Incident`(`unitId`);

-- CreateIndex
CREATE INDEX `Incident_escalationStartAt_status_idx` ON `Incident`(`escalationStartAt`, `status`);

-- AddForeignKey
ALTER TABLE `HospitalUnitMapping` ADD CONSTRAINT `HospitalUnitMapping_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `HospitalUnit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
