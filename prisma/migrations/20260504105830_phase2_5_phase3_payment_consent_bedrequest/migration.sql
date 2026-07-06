-- AlterTable
ALTER TABLE `IpdAdmission` ADD COLUMN `attenderFacilityAcceptanceSignatureId` VARCHAR(191) NULL,
    ADD COLUMN `consentSignatureIds` TEXT NULL,
    ADD COLUMN `nsAcceptanceSignatureId` VARCHAR(191) NULL,
    MODIFY `status` VARCHAR(191) NOT NULL DEFAULT 'PROPOSED';

-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `paidAmount` DOUBLE NULL,
    ADD COLUMN `paidAt` DATETIME(3) NULL,
    ADD COLUMN `paymentSource` VARCHAR(191) NULL,
    ADD COLUMN `paymentStatus` VARCHAR(191) NULL DEFAULT 'unpaid',
    ADD COLUMN `receiptNo` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `IpdBedRequest` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `wardId` VARCHAR(191) NULL,
    `preferredBedType` VARCHAR(191) NULL,
    `urgency` VARCHAR(191) NOT NULL DEFAULT 'routine',
    `status` VARCHAR(191) NOT NULL DEFAULT 'REQUESTED',
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `requestedBy` VARCHAR(191) NULL,
    `requestedById` INTEGER NULL,
    `acceptedAt` DATETIME(3) NULL,
    `acceptedBy` VARCHAR(191) NULL,
    `acceptedById` INTEGER NULL,
    `nsAcceptanceSignatureId` VARCHAR(191) NULL,
    `holdReason` TEXT NULL,
    `rejectReason` TEXT NULL,
    `attenderAcceptedAt` DATETIME(3) NULL,
    `attenderName` VARCHAR(191) NULL,
    `attenderRelation` VARCHAR(191) NULL,
    `attenderFacilitySignatureId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IpdBedRequest_admissionId_idx`(`admissionId`),
    INDEX `IpdBedRequest_status_idx`(`status`),
    INDEX `IpdBedRequest_wardId_status_idx`(`wardId`, `status`),
    INDEX `IpdBedRequest_requestedAt_idx`(`requestedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RevenueRollup` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NULL,
    `departmentName` VARCHAR(191) NULL,
    `doctorId` INTEGER NULL,
    `doctorName` VARCHAR(191) NULL,
    `serviceType` VARCHAR(191) NOT NULL,
    `appointmentCount` INTEGER NOT NULL DEFAULT 0,
    `totalAmount` DOUBLE NOT NULL DEFAULT 0,
    `computedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RevenueRollup_date_idx`(`date`),
    INDEX `RevenueRollup_departmentId_date_idx`(`departmentId`, `date`),
    INDEX `RevenueRollup_doctorId_date_idx`(`doctorId`, `date`),
    UNIQUE INDEX `RevenueRollup_date_departmentId_doctorId_serviceType_key`(`date`, `departmentId`, `doctorId`, `serviceType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `appointments_paymentStatus_paidAt_idx` ON `appointments`(`paymentStatus`, `paidAt`);

-- AddForeignKey
ALTER TABLE `IpdBedRequest` ADD CONSTRAINT `IpdBedRequest_admissionId_fkey` FOREIGN KEY (`admissionId`) REFERENCES `IpdAdmission`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
