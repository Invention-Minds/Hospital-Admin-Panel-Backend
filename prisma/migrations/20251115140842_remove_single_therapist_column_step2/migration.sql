/*
  Warnings:

  - You are about to drop the column `therapistId` on the `TherapyAppointment` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX `TherapyAppointment_therapistId_idx` ON `TherapyAppointment`;

-- AlterTable
ALTER TABLE `TherapyAppointment` DROP COLUMN `therapistId`;
