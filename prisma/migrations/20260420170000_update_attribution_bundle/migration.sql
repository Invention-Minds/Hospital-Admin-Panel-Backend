-- Sprint 4b · Phase 4b.1 — Update attribution full pass (MRD.1).
-- Adds `updatedBy` to the 5 models still missing it, and `updatedById` to all 7 clinical models.
-- All additive nullable columns; MySQL 8.0+ INSTANT algorithm; zero row rewrite, zero data mutation.

-- AlterTable
ALTER TABLE `DamaRecord` ADD COLUMN `updatedBy` VARCHAR(191) NULL,
    ADD COLUMN `updatedById` INTEGER NULL;

-- AlterTable
ALTER TABLE `IpdDischarge` ADD COLUMN `updatedBy` VARCHAR(191) NULL,
    ADD COLUMN `updatedById` INTEGER NULL;

-- AlterTable
ALTER TABLE `IpdMedicationLog` ADD COLUMN `updatedBy` VARCHAR(191) NULL,
    ADD COLUMN `updatedById` INTEGER NULL;

-- AlterTable
ALTER TABLE `IpdPrescription` ADD COLUMN `updatedById` INTEGER NULL;

-- AlterTable
ALTER TABLE `IpdProgressNote` ADD COLUMN `updatedBy` VARCHAR(191) NULL,
    ADD COLUMN `updatedById` INTEGER NULL;

-- AlterTable
ALTER TABLE `LamaRecord` ADD COLUMN `updatedBy` VARCHAR(191) NULL,
    ADD COLUMN `updatedById` INTEGER NULL;

-- AlterTable
ALTER TABLE `MlcCase` ADD COLUMN `updatedById` INTEGER NULL;
