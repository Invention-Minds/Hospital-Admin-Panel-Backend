-- CreateTable
CREATE TABLE `EmergencyReferral` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `emergencyId` INTEGER NOT NULL,
    `referredToDoctorId` INTEGER NOT NULL,
    `referredByName` VARCHAR(191) NULL,
    `referredById` INTEGER NULL,
    `reason` TEXT NULL,
    `triageCategory` VARCHAR(191) NOT NULL,
    `slaMinutes` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `referredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `acknowledgedAt` DATETIME(3) NULL,
    `acknowledgedByName` VARCHAR(191) NULL,
    `acknowledgedById` INTEGER NULL,
    `escalationLevel` INTEGER NOT NULL DEFAULT 0,
    `lastEscalatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `EmergencyReferral_emergencyId_idx`(`emergencyId`),
    INDEX `EmergencyReferral_referredToDoctorId_idx`(`referredToDoctorId`),
    INDEX `EmergencyReferral_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EscalationChainStep` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `departmentId` INTEGER NOT NULL,
    `level` INTEGER NOT NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `targetDoctorId` INTEGER NULL,
    `targetRole` VARCHAR(191) NULL,
    `label` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `EscalationChainStep_departmentId_level_idx`(`departmentId`, `level`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReferralSlaConfig` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `triageCategory` VARCHAR(191) NOT NULL,
    `minutes` INTEGER NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ReferralSlaConfig_triageCategory_key`(`triageCategory`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EmergencyReferral` ADD CONSTRAINT `EmergencyReferral_emergencyId_fkey` FOREIGN KEY (`emergencyId`) REFERENCES `Emergency`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmergencyReferral` ADD CONSTRAINT `EmergencyReferral_referredToDoctorId_fkey` FOREIGN KEY (`referredToDoctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EscalationChainStep` ADD CONSTRAINT `EscalationChainStep_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EscalationChainStep` ADD CONSTRAINT `EscalationChainStep_targetDoctorId_fkey` FOREIGN KEY (`targetDoctorId`) REFERENCES `Doctor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
