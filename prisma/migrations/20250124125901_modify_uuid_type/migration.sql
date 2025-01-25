/*
  Warnings:

  - You are about to alter the column `patientUHID` on the `estimation_details` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Int`.

*/
-- AlterTable
ALTER TABLE `estimation_details` MODIFY `patientUHID` INTEGER NULL;
