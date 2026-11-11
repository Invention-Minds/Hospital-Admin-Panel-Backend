-- AlterTable
ALTER TABLE `DiagnosisCodeMaster` ADD COLUMN `specialty` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `DiagnosisCodeMaster_specialty_idx` ON `DiagnosisCodeMaster`(`specialty`);
