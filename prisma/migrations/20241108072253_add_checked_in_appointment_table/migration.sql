/*
  Warnings:

  - A unique constraint covering the columns `[doctorId,date,time]` on the table `UnavailableSlot` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `checkedIn` BOOLEAN NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX `UnavailableSlot_doctorId_date_time_key` ON `UnavailableSlot`(`doctorId`, `date`, `time`);
