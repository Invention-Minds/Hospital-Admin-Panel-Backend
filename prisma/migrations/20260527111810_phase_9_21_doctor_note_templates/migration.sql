-- AlterTable
ALTER TABLE `NoteTemplate` ADD COLUMN `doctorId` INTEGER NULL;

-- CreateTable
CREATE TABLE `CodeActivation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL,
    `situation` VARCHAR(191) NOT NULL,
    `dialNumber` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NULL,
    `emergencyId` INTEGER NULL,
    `patientName` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `autoSuggested` BOOLEAN NOT NULL DEFAULT false,
    `note` TEXT NULL,
    `triggeredByName` VARCHAR(191) NULL,
    `triggeredById` INTEGER NULL,
    `triggeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedByName` VARCHAR(191) NULL,
    `resolvedById` INTEGER NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CodeActivation_status_idx`(`status`),
    INDEX `CodeActivation_code_idx`(`code`),
    INDEX `CodeActivation_triggeredAt_idx`(`triggeredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `NoteTemplate_doctorId_noteType_isActive_idx` ON `NoteTemplate`(`doctorId`, `noteType`, `isActive`);

-- AddForeignKey
ALTER TABLE `NoteTemplate` ADD CONSTRAINT `NoteTemplate_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
