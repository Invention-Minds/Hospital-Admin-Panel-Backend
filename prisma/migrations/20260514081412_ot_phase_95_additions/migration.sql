-- CreateTable
CREATE TABLE `OtEquipmentMaster` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NULL,
    `category` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    UNIQUE INDEX `OtEquipmentMaster_name_key`(`name`),
    UNIQUE INDEX `OtEquipmentMaster_code_key`(`code`),
    INDEX `OtEquipmentMaster_category_idx`(`category`),
    INDEX `OtEquipmentMaster_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FixedSurgicalNote` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NULL,
    `body` LONGTEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    UNIQUE INDEX `FixedSurgicalNote_code_key`(`code`),
    INDEX `FixedSurgicalNote_departmentId_idx`(`departmentId`),
    INDEX `FixedSurgicalNote_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmrgSurgerySurcharge` (
    `id` VARCHAR(191) NOT NULL,
    `scheduleId` VARCHAR(191) NOT NULL,
    `surchargeType` VARCHAR(191) NOT NULL,
    `reason` TEXT NULL,
    `baseAmount` DOUBLE NOT NULL DEFAULT 0,
    `percent` DOUBLE NOT NULL DEFAULT 0,
    `flatAmount` DOUBLE NOT NULL DEFAULT 0,
    `totalAmount` DOUBLE NOT NULL DEFAULT 0,
    `appliedToEstimation` BOOLEAN NOT NULL DEFAULT false,
    `estimationLineId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,

    INDEX `EmrgSurgerySurcharge_scheduleId_idx`(`scheduleId`),
    INDEX `EmrgSurgerySurcharge_surchargeType_idx`(`surchargeType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EmrgSurgerySurcharge` ADD CONSTRAINT `EmrgSurgerySurcharge_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `OtSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
