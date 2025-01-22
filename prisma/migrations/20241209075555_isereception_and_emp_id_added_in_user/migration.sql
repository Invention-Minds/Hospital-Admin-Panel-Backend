-- AlterTable
ALTER TABLE `users` ADD COLUMN `employeeId` INTEGER NULL,
    ADD COLUMN `isReceptionist` BOOLEAN NULL DEFAULT false;
