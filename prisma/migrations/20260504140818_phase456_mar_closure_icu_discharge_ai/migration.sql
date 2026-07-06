-- AlterTable
ALTER TABLE `IpdDischarge` ADD COLUMN `aiDraftJson` LONGTEXT NULL,
    ADD COLUMN `aiDraftedAt` DATETIME(3) NULL,
    ADD COLUMN `aiDraftedByModel` VARCHAR(191) NULL,
    ADD COLUMN `attenderAcknowledgedAt` DATETIME(3) NULL,
    ADD COLUMN `attenderAcknowledgmentSignatureId` VARCHAR(191) NULL,
    ADD COLUMN `attenderName` VARCHAR(191) NULL,
    ADD COLUMN `attenderRelation` VARCHAR(191) NULL,
    ADD COLUMN `clinicianSignatureId` VARCHAR(191) NULL,
    ADD COLUMN `clinicianSignedAt` DATETIME(3) NULL,
    ADD COLUMN `clinicianSignedBy` VARCHAR(191) NULL,
    ADD COLUMN `clinicianSignedById` INTEGER NULL,
    ADD COLUMN `summaryStatus` VARCHAR(191) NOT NULL DEFAULT 'NONE';

-- CreateIndex
CREATE INDEX `IpdDischarge_summaryStatus_idx` ON `IpdDischarge`(`summaryStatus`);
