/*
  Warnings:

  - Added the required column `extraHoursAfter` to the `ExtraSlotCount` table without a default value. This is not possible if the table is not empty.
  - Added the required column `extraHoursBefore` to the `ExtraSlotCount` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `ExtraSlotCount` ADD COLUMN `extraHoursAfter` VARCHAR(191) NOT NULL,
    ADD COLUMN `extraHoursBefore` VARCHAR(191) NOT NULL;
