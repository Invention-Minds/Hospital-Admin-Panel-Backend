-- CreateTable
CREATE TABLE `IpdInsulinInfusion` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL,
    `bloodGlucoseMgDl` INTEGER NULL,
    `insulinOrder` TEXT NULL,
    `doctorName` VARCHAR(191) NULL,
    `doctorSignatureId` VARCHAR(191) NULL,
    `nurseName` VARCHAR(191) NULL,
    `nurseSignatureId` VARCHAR(191) NULL,
    `remarks` TEXT NULL,
    `recordedBy` VARCHAR(191) NULL,
    `recordedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IpdInsulinInfusion_admissionId_recordedAt_idx`(`admissionId`, `recordedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `IpdInsulinInfusion` ADD CONSTRAINT `IpdInsulinInfusion_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
