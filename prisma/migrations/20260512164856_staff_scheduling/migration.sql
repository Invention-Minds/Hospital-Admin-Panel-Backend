-- CreateTable
CREATE TABLE `ShiftDefinition` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `startTime` VARCHAR(191) NOT NULL,
    `endTime` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ShiftDefinition_name_key`(`name`),
    UNIQUE INDEX `ShiftDefinition_code_key`(`code`),
    INDEX `ShiftDefinition_isActive_sequence_idx`(`isActive`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StaffShiftAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `shiftId` VARCHAR(191) NOT NULL,
    `wardId` VARCHAR(191) NULL,
    `date` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'SCHEDULED',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,

    INDEX `StaffShiftAssignment_date_wardId_idx`(`date`, `wardId`),
    INDEX `StaffShiftAssignment_wardId_date_idx`(`wardId`, `date`),
    INDEX `StaffShiftAssignment_userId_date_idx`(`userId`, `date`),
    INDEX `StaffShiftAssignment_status_idx`(`status`),
    UNIQUE INDEX `StaffShiftAssignment_userId_date_shiftId_key`(`userId`, `date`, `shiftId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DutyAcknowledgement` (
    `id` VARCHAR(191) NOT NULL,
    `assignmentId` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `acknowledgedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `signatureId` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'MODAL',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DutyAcknowledgement_assignmentId_idx`(`assignmentId`),
    INDEX `DutyAcknowledgement_userId_acknowledgedAt_idx`(`userId`, `acknowledgedAt`),
    INDEX `DutyAcknowledgement_acknowledgedAt_idx`(`acknowledgedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `StaffShiftAssignment` ADD CONSTRAINT `StaffShiftAssignment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StaffShiftAssignment` ADD CONSTRAINT `StaffShiftAssignment_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `ShiftDefinition`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StaffShiftAssignment` ADD CONSTRAINT `StaffShiftAssignment_wardId_fkey` FOREIGN KEY (`wardId`) REFERENCES `IpdWard`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DutyAcknowledgement` ADD CONSTRAINT `DutyAcknowledgement_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `StaffShiftAssignment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DutyAcknowledgement` ADD CONSTRAINT `DutyAcknowledgement_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
