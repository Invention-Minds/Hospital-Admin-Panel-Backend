/*
  Warnings:

  - You are about to drop the `doctorunavailabledate` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `doctorunavailabledate` DROP FOREIGN KEY `DoctorUnavailableDate_doctorId_fkey`;

-- DropTable
DROP TABLE `doctorunavailabledate`;

-- CreateTable
CREATE TABLE `UnavailableDates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `doctorId` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `UnavailableDates` ADD CONSTRAINT `UnavailableDates_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
