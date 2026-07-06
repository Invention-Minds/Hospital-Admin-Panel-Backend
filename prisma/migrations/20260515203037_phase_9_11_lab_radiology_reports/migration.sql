/*
  Warnings:

  - A unique constraint covering the columns `[webhookProvider,hmisResultId]` on the table `InvestigationResult` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `InvestigationResult` ADD COLUMN `acknowledgedAt` DATETIME(3) NULL,
    ADD COLUMN `acknowledgedBy` VARCHAR(191) NULL,
    ADD COLUMN `acknowledgedById` INTEGER NULL,
    ADD COLUMN `findings` TEXT NULL,
    ADD COLUMN `impression` TEXT NULL,
    ADD COLUMN `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `uploadedAt` DATETIME(3) NULL,
    ADD COLUMN `uploadedBy` VARCHAR(191) NULL,
    ADD COLUMN `uploadedById` INTEGER NULL,
    ADD COLUMN `webhookProvider` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `InvestigationResult_criticalFlag_acknowledgedAt_idx` ON `InvestigationResult`(`criticalFlag`, `acknowledgedAt`);

-- CreateIndex
CREATE INDEX `InvestigationResult_department_idx` ON `InvestigationResult`(`department`);

-- CreateIndex
CREATE INDEX `InvestigationResult_isDeleted_idx` ON `InvestigationResult`(`isDeleted`);

-- CreateIndex
CREATE UNIQUE INDEX `InvestigationResult_webhookProvider_hmisResultId_key` ON `InvestigationResult`(`webhookProvider`, `hmisResultId`);

-- AddForeignKey
ALTER TABLE `InvestigationResult` ADD CONSTRAINT `InvestigationResult_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `InvestigationOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
