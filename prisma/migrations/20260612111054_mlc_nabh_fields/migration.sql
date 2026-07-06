-- AlterTable
ALTER TABLE `MlcCase` ADD COLUMN `allegedCause` TEXT NULL,
    ADD COLUMN `broughtBy` VARCHAR(191) NULL,
    ADD COLUMN `broughtByDetail` VARCHAR(191) NULL,
    ADD COLUMN `consentForExamTime` DATETIME(3) NULL,
    ADD COLUMN `consentForExamination` BOOLEAN NULL,
    ADD COLUMN `examiningDoctorRegNo` VARCHAR(191) NULL,
    ADD COLUMN `identificationMark1` VARCHAR(191) NULL,
    ADD COLUMN `identificationMark2` VARCHAR(191) NULL,
    ADD COLUMN `incidentDateTime` DATETIME(3) NULL,
    ADD COLUMN `incidentPlace` VARCHAR(191) NULL,
    ADD COLUMN `informantName` VARCHAR(191) NULL,
    ADD COLUMN `informantRelation` VARCHAR(191) NULL,
    ADD COLUMN `injuryOpinion` VARCHAR(191) NULL,
    ADD COLUMN `policeIntimationBy` VARCHAR(191) NULL,
    ADD COLUMN `policeIntimationMode` VARCHAR(191) NULL,
    ADD COLUMN `policeIntimationTime` DATETIME(3) NULL,
    ADD COLUMN `referredTo` VARCHAR(191) NULL,
    ADD COLUMN `weaponType` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `MlcInjury` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `mlcCaseId` INTEGER NOT NULL,
    `site` VARCHAR(191) NOT NULL,
    `injuryType` VARCHAR(191) NULL,
    `size` VARCHAR(191) NULL,
    `ageOfInjury` VARCHAR(191) NULL,
    `weaponLikely` VARCHAR(191) NULL,
    `simpleOrGrievous` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MlcInjury_mlcCaseId_idx`(`mlcCaseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MlcInjury` ADD CONSTRAINT `MlcInjury_mlcCaseId_fkey` FOREIGN KEY (`mlcCaseId`) REFERENCES `MlcCase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
