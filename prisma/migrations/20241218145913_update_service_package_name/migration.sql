/*
  Warnings:

  - Added the required column `packageName` to the `Service` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `Service` ADD COLUMN `packageName` VARCHAR(191) NOT NULL;
