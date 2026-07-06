-- AlterTable
ALTER TABLE `OtSchedule` ADD COLUMN `extubationAt` DATETIME(3) NULL,
    ADD COLUMN `inductionAt` DATETIME(3) NULL,
    ADD COLUMN `otAdmissionAt` DATETIME(3) NULL,
    ADD COLUMN `otDischargeAt` DATETIME(3) NULL,
    ADD COLUMN `requisitionId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `OtRequisition` (
    `id` VARCHAR(191) NOT NULL,
    `requisitionNo` VARCHAR(191) NULL,
    `prn` VARCHAR(191) NULL,
    `patientName` VARCHAR(191) NULL,
    `patientAdmitted` BOOLEAN NOT NULL DEFAULT false,
    `admissionId` VARCHAR(191) NULL,
    `bedCategory` VARCHAR(191) NULL,
    `phoneNumber` VARCHAR(191) NULL,
    `otRoomId` VARCHAR(191) NULL,
    `bookingFrom` DATETIME(3) NOT NULL,
    `bookingTo` DATETIME(3) NOT NULL,
    `primarySurgery` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NULL,
    `categoryCode` VARCHAR(191) NULL,
    `surgeonId` INTEGER NULL,
    `surgeonName` VARCHAR(191) NULL,
    `anaesthetistId` INTEGER NULL,
    `anaesthetistName` VARCHAR(191) NULL,
    `anaesthesiaType` VARCHAR(191) NULL,
    `additionalSurgeries` JSON NULL,
    `specialInstructions` TEXT NULL,
    `requisitionBy` VARCHAR(191) NULL,
    `requisitionById` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `cancelReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,

    UNIQUE INDEX `OtRequisition_requisitionNo_key`(`requisitionNo`),
    INDEX `OtRequisition_status_idx`(`status`),
    INDEX `OtRequisition_prn_idx`(`prn`),
    INDEX `OtRequisition_admissionId_idx`(`admissionId`),
    INDEX `OtRequisition_bookingFrom_idx`(`bookingFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OtScheduleStaff` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `scheduleId` VARCHAR(191) NOT NULL,
    `staffId` INTEGER NULL,
    `staffName` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `surgeryId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    INDEX `OtScheduleStaff_scheduleId_idx`(`scheduleId`),
    INDEX `OtScheduleStaff_staffId_idx`(`staffId`),
    INDEX `OtScheduleStaff_role_idx`(`role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OtScheduleSurgery` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `scheduleId` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NULL,
    `departmentName` VARCHAR(191) NULL,
    `categoryCode` VARCHAR(191) NULL,
    `surgeryName` VARCHAR(191) NOT NULL,
    `surgeryCode` VARCHAR(191) NULL,
    `surgeryType` VARCHAR(191) NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    INDEX `OtScheduleSurgery_scheduleId_idx`(`scheduleId`),
    INDEX `OtScheduleSurgery_departmentId_idx`(`departmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `OtSchedule_requisitionId_idx` ON `OtSchedule`(`requisitionId`);

-- AddForeignKey
ALTER TABLE `OtSchedule` ADD CONSTRAINT `OtSchedule_requisitionId_fkey` FOREIGN KEY (`requisitionId`) REFERENCES `OtRequisition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OtScheduleStaff` ADD CONSTRAINT `OtScheduleStaff_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `OtSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OtScheduleSurgery` ADD CONSTRAINT `OtScheduleSurgery_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `OtSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
