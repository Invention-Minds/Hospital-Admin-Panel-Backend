-- DropForeignKey
ALTER TABLE `BookedSlot` DROP FOREIGN KEY `BookedSlot_doctorId_fkey`;

-- DropForeignKey
ALTER TABLE `DoctorAvailability` DROP FOREIGN KEY `DoctorAvailability_doctorId_fkey`;

-- DropForeignKey
ALTER TABLE `UnavailableDates` DROP FOREIGN KEY `UnavailableDates_doctorId_fkey`;

-- DropForeignKey
ALTER TABLE `UnavailableSlot` DROP FOREIGN KEY `UnavailableSlot_doctorId_fkey`;

-- DropForeignKey
ALTER TABLE `appointments` DROP FOREIGN KEY `appointments_doctorId_fkey`;

-- AlterTable
ALTER TABLE `BookedSlot` MODIFY `doctorId` INTEGER NULL;

-- AlterTable
ALTER TABLE `DoctorAvailability` MODIFY `doctorId` INTEGER NULL;

-- AlterTable
ALTER TABLE `UnavailableDates` MODIFY `doctorId` INTEGER NULL;

-- AlterTable
ALTER TABLE `UnavailableSlot` MODIFY `doctorId` INTEGER NULL;

-- AlterTable
ALTER TABLE `appointments` MODIFY `doctorId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `DoctorAvailability` ADD CONSTRAINT `DoctorAvailability_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UnavailableDates` ADD CONSTRAINT `UnavailableDates_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookedSlot` ADD CONSTRAINT `BookedSlot_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UnavailableSlot` ADD CONSTRAINT `UnavailableSlot_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
