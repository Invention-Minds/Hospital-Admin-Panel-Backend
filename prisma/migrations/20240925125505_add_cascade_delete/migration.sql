-- DropForeignKey
ALTER TABLE `doctoravailability` DROP FOREIGN KEY `DoctorAvailability_doctorId_fkey`;

-- AddForeignKey
ALTER TABLE `DoctorAvailability` ADD CONSTRAINT `DoctorAvailability_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
