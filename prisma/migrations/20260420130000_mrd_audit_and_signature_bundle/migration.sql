-- Sprint 4a · Phase 1a — MRD audit columns + doctor signature + modification reason + timestamp gap-fill.
-- All changes are nullable ADD COLUMN. MySQL 8.0+ INSTANT algorithm applies; zero row rewrite, zero data mutation.

-- AlterTable
ALTER TABLE `DamaRecord` ADD COLUMN `createdById` INTEGER NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `IpdDischarge` ADD COLUMN `createdById` INTEGER NULL,
    ADD COLUMN `doctorSignature` VARCHAR(191) NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `IpdMedicationLog` ADD COLUMN `createdById` INTEGER NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `IpdPrescription` ADD COLUMN `createdById` INTEGER NULL,
    ADD COLUMN `modificationReason` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `IpdProgressNote` ADD COLUMN `createdById` INTEGER NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `LamaRecord` ADD COLUMN `createdById` INTEGER NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `MlcCase` ADD COLUMN `createdById` INTEGER NULL;
