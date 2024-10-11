/*
  Warnings:

  - You are about to drop the column `request_via` on the `appointments` table. All the data in the column will be lost.
  - You are about to drop the column `sms_sent` on the `appointments` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `appointments` DROP COLUMN `request_via`,
    DROP COLUMN `sms_sent`,
    ADD COLUMN `requestVia` VARCHAR(191) NULL,
    ADD COLUMN `smsSent` BOOLEAN NULL DEFAULT false;
