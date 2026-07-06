/*
  Warnings:

  - You are about to drop the `TherapistLeave` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TherapistShift` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `TherapistLeave` DROP FOREIGN KEY `TherapistLeave_therapistId_fkey`;

-- DropForeignKey
ALTER TABLE `TherapistShift` DROP FOREIGN KEY `TherapistShift_therapistId_fkey`;

-- DropTable
DROP TABLE `TherapistLeave`;

-- DropTable
DROP TABLE `TherapistShift`;

-- CreateTable
CREATE TABLE `TherapistUnavailableDates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `therapistId` INTEGER NULL,
    `date` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NULL,

    INDEX `TherapistUnavailableDates_therapistId_idx`(`therapistId`),
    UNIQUE INDEX `TherapistUnavailableDates_therapistId_date_key`(`therapistId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TherapistUnavailableSlot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `therapistId` INTEGER NULL,
    `time` VARCHAR(191) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NULL,

    UNIQUE INDEX `TherapistUnavailableSlot_therapistId_date_time_key`(`therapistId`, `date`, `time`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TherapistUnavailableDates` ADD CONSTRAINT `TherapistUnavailableDates_therapistId_fkey` FOREIGN KEY (`therapistId`) REFERENCES `Therapist`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TherapistUnavailableSlot` ADD CONSTRAINT `TherapistUnavailableSlot_therapistId_fkey` FOREIGN KEY (`therapistId`) REFERENCES `Therapist`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
