/*
  Warnings:

  - You are about to drop the column `prn` on the `appointments` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `appointments` DROP COLUMN `prn`,
    ADD COLUMN `prnNumber` INTEGER NULL;
