-- AlterTable
ALTER TABLE `PatientDetails` ADD COLUMN `hmisUhid` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `PatientDetails_hmisUhid_idx` ON `PatientDetails`(`hmisUhid`);
