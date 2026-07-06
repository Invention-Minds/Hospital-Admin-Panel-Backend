-- Phase 9.4c — EstimationSurgeryLine (per-role surgery billing).
-- Strictly additive: one new table.

CREATE TABLE `EstimationSurgeryLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `estimationId` VARCHAR(191) NOT NULL,
    `surgeryName` VARCHAR(191) NOT NULL,
    `departmentName` VARCHAR(191) NULL,
    `categoryCode` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL,
    `serviceCode` VARCHAR(191) NULL,
    `serviceName` VARCHAR(191) NOT NULL,
    `renderedBy` VARCHAR(191) NULL,
    `rate` DOUBLE NOT NULL DEFAULT 0,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `discountPercent` DOUBLE NOT NULL DEFAULT 0,
    `discountReason` TEXT NULL,
    `adjustmentAmount` DOUBLE NOT NULL DEFAULT 0,
    `adjustmentReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    INDEX `EstimationSurgeryLine_estimationId_idx`(`estimationId`),
    INDEX `EstimationSurgeryLine_role_idx`(`role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
