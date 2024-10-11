/*
  Warnings:

  - You are about to drop the column `availableTo` on the `doctoravailability` table. All the data in the column will be lost.
  - Made the column `departmentId` on table `doctor` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE `doctor` DROP FOREIGN KEY `Doctor_departmentId_fkey`;

-- AlterTable
ALTER TABLE `doctor` MODIFY `departmentId` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `doctoravailability` DROP COLUMN `availableTo`;

-- CreateTable
CREATE TABLE `DoctorUnavailableDate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `doctorId` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Doctor` ADD CONSTRAINT `Doctor_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DoctorUnavailableDate` ADD CONSTRAINT `DoctorUnavailableDate_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
