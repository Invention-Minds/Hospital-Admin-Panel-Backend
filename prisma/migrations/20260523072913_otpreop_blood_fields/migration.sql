-- AlterTable
ALTER TABLE `OtPreOpChecklist` ADD COLUMN `anticipatedBloodLossMl` INTEGER NULL,
    ADD COLUMN `externalUnitsReserved` INTEGER NULL,
    ADD COLUMN `internalUnitsReserved` INTEGER NULL,
    ADD COLUMN `preOpHemoglobin` DOUBLE NULL,
    ADD COLUMN `surgeryClass` VARCHAR(191) NULL;
