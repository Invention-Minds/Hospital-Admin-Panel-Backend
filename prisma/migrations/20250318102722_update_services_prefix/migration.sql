-- AlterTable
ALTER TABLE `Service` ADD COLUMN `prefix` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `ServiceAppointments` ADD COLUMN `prefix` VARCHAR(191) NULL;
