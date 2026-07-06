-- AlterTable
ALTER TABLE `IpdAdmission` ADD COLUMN `referralEstimationId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `OtRequisition` ADD COLUMN `estimationId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `OtRequisition_estimationId_idx` ON `OtRequisition`(`estimationId`);
