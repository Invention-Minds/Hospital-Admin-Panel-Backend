-- AlterTable
ALTER TABLE `PatientDetails` ADD COLUMN `abhaIdHash` VARCHAR(191) NULL,
    ADD COLUMN `abhaIdLast4` VARCHAR(191) NULL,
    ADD COLUMN `chronicConditions` TEXT NULL,
    ADD COLUMN `consentAcceptedAt` DATETIME(3) NULL,
    ADD COLUMN `consentSignatureId` VARCHAR(191) NULL,
    ADD COLUMN `consentVersionAccepted` VARCHAR(191) NULL,
    ADD COLUMN `createdBy` VARCHAR(191) NULL,
    ADD COLUMN `createdById` INTEGER NULL,
    ADD COLUMN `currentMedications` TEXT NULL,
    ADD COLUMN `knownAllergies` TEXT NULL,
    ADD COLUMN `nextOfKinName` VARCHAR(191) NULL,
    ADD COLUMN `nextOfKinPhone` VARCHAR(191) NULL,
    ADD COLUMN `nextOfKinRelation` VARCHAR(191) NULL,
    ADD COLUMN `preferredCommChannel` VARCHAR(191) NULL,
    ADD COLUMN `preferredLanguage` VARCHAR(191) NULL,
    ADD COLUMN `source` VARCHAR(191) NULL DEFAULT 'admin',
    ADD COLUMN `updatedBy` VARCHAR(191) NULL,
    ADD COLUMN `updatedById` INTEGER NULL,
    ADD COLUMN `verified` BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX `PatientDetails_source_verified_idx` ON `PatientDetails`(`source`, `verified`);
