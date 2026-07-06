-- AlterTable
ALTER TABLE `InvestigationOrder` ADD COLUMN `radAllergyHistory` TEXT NULL,
    ADD COLUMN `radClinicalDetails` TEXT NULL,
    ADD COLUMN `radComorbidities` VARCHAR(191) NULL,
    ADD COLUMN `radConsentGiven` BOOLEAN NULL,
    ADD COLUMN `radCreatinineDoneOn` VARCHAR(191) NULL,
    ADD COLUMN `radLmp` VARCHAR(191) NULL,
    ADD COLUMN `radPregnancy` BOOLEAN NULL,
    ADD COLUMN `radPriority` VARCHAR(191) NULL,
    ADD COLUMN `radSerumCreatinine` VARCHAR(191) NULL,
    ADD COLUMN `radWeightKg` VARCHAR(191) NULL;
