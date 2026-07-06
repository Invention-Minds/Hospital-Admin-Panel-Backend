-- AlterTable
ALTER TABLE `DamaRecord` ADD COLUMN `admissionId` VARCHAR(191) NULL,
    MODIFY `emergencyId` INTEGER NULL;

-- AlterTable
ALTER TABLE `LamaRecord` ADD COLUMN `admissionId` VARCHAR(191) NULL,
    MODIFY `emergencyId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `DamaRecord_admissionId_idx` ON `DamaRecord`(`admissionId`);

-- CreateIndex
CREATE INDEX `LamaRecord_admissionId_idx` ON `LamaRecord`(`admissionId`);

-- AddForeignKey
ALTER TABLE `LamaRecord` ADD CONSTRAINT `LamaRecord_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DamaRecord` ADD CONSTRAINT `DamaRecord_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
