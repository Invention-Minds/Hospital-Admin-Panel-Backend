-- AlterTable
ALTER TABLE `estimation_details` ADD COLUMN `patientRemarks` VARCHAR(191) NULL,
    ADD COLUMN `staffRemarks` VARCHAR(191) NULL,
    ADD COLUMN `surgeryPackage` VARCHAR(191) NULL;
