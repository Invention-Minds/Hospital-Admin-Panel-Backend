-- CreateTable
CREATE TABLE `OtEquipmentUsage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `scheduleId` VARCHAR(191) NOT NULL,
    `surgeryId` INTEGER NULL,
    `equipmentName` VARCHAR(191) NOT NULL,
    `equipmentCode` VARCHAR(191) NULL,
    `usedMinutes` INTEGER NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    INDEX `OtEquipmentUsage_scheduleId_idx`(`scheduleId`),
    INDEX `OtEquipmentUsage_equipmentName_idx`(`equipmentName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OtConsumableSet` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NULL,
    `description` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    UNIQUE INDEX `OtConsumableSet_name_key`(`name`),
    INDEX `OtConsumableSet_departmentId_idx`(`departmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OtConsumableSetItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `setId` INTEGER NOT NULL,
    `tabletMasterId` INTEGER NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `defaultQuantity` INTEGER NOT NULL DEFAULT 1,
    `uom` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OtConsumableSetItem_setId_idx`(`setId`),
    INDEX `OtConsumableSetItem_tabletMasterId_idx`(`tabletMasterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OtConsumableIssue` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `scheduleId` VARCHAR(191) NOT NULL,
    `setId` INTEGER NULL,
    `tabletMasterId` INTEGER NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `uom` VARCHAR(191) NULL,
    `itemRemarks` VARCHAR(191) NULL,
    `pharmacyStore` VARCHAR(191) NULL,
    `prescribedBy` VARCHAR(191) NULL,
    `prescribedById` INTEGER NULL,
    `direction` VARCHAR(191) NOT NULL DEFAULT 'issued',
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    INDEX `OtConsumableIssue_scheduleId_idx`(`scheduleId`),
    INDEX `OtConsumableIssue_setId_idx`(`setId`),
    INDEX `OtConsumableIssue_direction_idx`(`direction`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `OtEquipmentUsage` ADD CONSTRAINT `OtEquipmentUsage_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `OtSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OtConsumableSetItem` ADD CONSTRAINT `OtConsumableSetItem_setId_fkey` FOREIGN KEY (`setId`) REFERENCES `OtConsumableSet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OtConsumableIssue` ADD CONSTRAINT `OtConsumableIssue_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `OtSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
