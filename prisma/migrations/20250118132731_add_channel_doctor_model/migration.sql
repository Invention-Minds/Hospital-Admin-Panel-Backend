/*
  Warnings:

  - A unique constraint covering the columns `[channelId]` on the table `Channel` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE `DoctorAssignment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `channelId` INTEGER NOT NULL,
    `doctorId` INTEGER NOT NULL,
    `departmentName` VARCHAR(191) NOT NULL,

    INDEX `DoctorAssignment_channelId_idx`(`channelId`),
    INDEX `DoctorAssignment_doctorId_idx`(`doctorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Channel_channelId_key` ON `Channel`(`channelId`);

-- AddForeignKey
ALTER TABLE `DoctorAssignment` ADD CONSTRAINT `DoctorAssignment_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `Channel`(`channelId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DoctorAssignment` ADD CONSTRAINT `DoctorAssignment_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
