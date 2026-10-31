/*
  Warnings:

  - A unique constraint covering the columns `[userId,seq]` on the table `download_logs` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `download_logs` ADD COLUMN `downloadRef` VARCHAR(191) NULL,
    ADD COLUMN `seq` INTEGER NULL;

-- CreateIndex
CREATE INDEX `download_logs_downloadRef_idx` ON `download_logs`(`downloadRef`);

-- CreateIndex
CREATE UNIQUE INDEX `download_logs_userId_seq_key` ON `download_logs`(`userId`, `seq`);
