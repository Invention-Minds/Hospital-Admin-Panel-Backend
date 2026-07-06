-- AlterTable
ALTER TABLE `IpdAdmission` ADD COLUMN `vitalsMonitoringFrequency` VARCHAR(191) NULL,
    ADD COLUMN `vitalsMonitoringSetAt` DATETIME(3) NULL,
    ADD COLUMN `vitalsMonitoringSetBy` VARCHAR(191) NULL;
