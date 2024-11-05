/*
  Warnings:

  - You are about to alter the column `prn` on the `Patient` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Int`.

*/
-- AlterTable
ALTER TABLE `Patient` MODIFY `prn` INTEGER NOT NULL;
