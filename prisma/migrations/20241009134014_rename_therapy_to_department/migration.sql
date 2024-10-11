/*
  Warnings:

  - You are about to drop the column `doctor_name` on the `appointments` table. All the data in the column will be lost.
  - You are about to drop the column `patient_name` on the `appointments` table. All the data in the column will be lost.
  - You are about to drop the column `phone_number` on the `appointments` table. All the data in the column will be lost.
  - You are about to drop the column `therapy` on the `appointments` table. All the data in the column will be lost.
  - Added the required column `department` to the `appointments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `doctorName` to the `appointments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `patientName` to the `appointments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `phoneNumber` to the `appointments` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `appointments` DROP COLUMN `doctor_name`,
    DROP COLUMN `patient_name`,
    DROP COLUMN `phone_number`,
    DROP COLUMN `therapy`,
    ADD COLUMN `department` VARCHAR(191) NOT NULL,
    ADD COLUMN `doctorName` VARCHAR(191) NOT NULL,
    ADD COLUMN `patientName` VARCHAR(191) NOT NULL,
    ADD COLUMN `phoneNumber` VARCHAR(191) NOT NULL,
    MODIFY `sms_sent` BOOLEAN NULL DEFAULT false;
