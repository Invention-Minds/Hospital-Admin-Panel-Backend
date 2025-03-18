-- AlterTable
ALTER TABLE `Service` ADD COLUMN `patientType` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `ServiceAppointments` ADD COLUMN `patientType` VARCHAR(191) NULL;
