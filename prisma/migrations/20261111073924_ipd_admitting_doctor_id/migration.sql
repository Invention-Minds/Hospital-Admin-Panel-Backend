-- AlterTable
ALTER TABLE `IpdAdmission` ADD COLUMN `admittingDoctorId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `IpdAdmission_admittingDoctorId_idx` ON `IpdAdmission`(`admittingDoctorId`);
