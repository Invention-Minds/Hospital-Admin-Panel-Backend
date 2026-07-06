-- CreateTable
CREATE TABLE `NursingStation` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `updatedBy` VARCHAR(191) NULL,

    UNIQUE INDEX `NursingStation_code_key`(`code`),
    INDEX `NursingStation_code_idx`(`code`),
    INDEX `NursingStation_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NursingStationWard` (
    `id` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `wardId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `NursingStationWard_wardId_idx`(`wardId`),
    INDEX `NursingStationWard_stationId_idx`(`stationId`),
    UNIQUE INDEX `NursingStationWard_stationId_wardId_key`(`stationId`, `wardId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NurseStationAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(191) NULL,

    INDEX `NurseStationAssignment_stationId_idx`(`stationId`),
    INDEX `NurseStationAssignment_userId_idx`(`userId`),
    UNIQUE INDEX `NurseStationAssignment_userId_stationId_key`(`userId`, `stationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `NursingStationWard` ADD CONSTRAINT `NursingStationWard_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `NursingStation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NursingStationWard` ADD CONSTRAINT `NursingStationWard_wardId_fkey` FOREIGN KEY (`wardId`) REFERENCES `IpdWard`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NurseStationAssignment` ADD CONSTRAINT `NurseStationAssignment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NurseStationAssignment` ADD CONSTRAINT `NurseStationAssignment_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `NursingStation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
