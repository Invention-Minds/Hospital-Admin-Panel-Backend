-- CreateTable
CREATE TABLE `NursingStationDepartment` (
    `id` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `NursingStationDepartment_departmentId_idx`(`departmentId`),
    INDEX `NursingStationDepartment_stationId_idx`(`stationId`),
    UNIQUE INDEX `NursingStationDepartment_stationId_departmentId_key`(`stationId`, `departmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `NursingStationDepartment` ADD CONSTRAINT `NursingStationDepartment_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `NursingStation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NursingStationDepartment` ADD CONSTRAINT `NursingStationDepartment_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
