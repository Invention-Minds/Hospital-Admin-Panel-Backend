-- AlterTable
ALTER TABLE `DoctorNote` ADD COLUMN `noteTemplateId` VARCHAR(191) NULL,
    ADD COLUMN `templatedValues` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `IpdDischarge` ADD COLUMN `noteTemplateId` VARCHAR(191) NULL,
    ADD COLUMN `templatedValues` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `OPDAssessment` ADD COLUMN `noteTemplateId` VARCHAR(191) NULL,
    ADD COLUMN `templatedValues` LONGTEXT NULL;

-- CreateTable
CREATE TABLE `NoteTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `noteType` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NOT NULL,
    `fields` LONGTEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,
    `updatedBy` VARCHAR(191) NULL,
    `updatedById` INTEGER NULL,

    INDEX `NoteTemplate_department_noteType_isActive_idx`(`department`, `noteType`, `isActive`),
    INDEX `NoteTemplate_noteType_idx`(`noteType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `IpdDischarge_noteTemplateId_idx` ON `IpdDischarge`(`noteTemplateId`);
