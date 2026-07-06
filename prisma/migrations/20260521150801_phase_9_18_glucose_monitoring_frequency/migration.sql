-- AlterTable
ALTER TABLE `IpdAdmission` ADD COLUMN `glucoseMonitoringFrequency` VARCHAR(191) NULL,
    ADD COLUMN `glucoseMonitoringSetAt` DATETIME(3) NULL,
    ADD COLUMN `glucoseMonitoringSetBy` VARCHAR(191) NULL;
