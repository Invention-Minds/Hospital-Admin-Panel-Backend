/*
  Warnings:

  - A unique constraint covering the columns `[email]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `users` ADD COLUMN `email` VARCHAR(191) NULL,
    ADD COLUMN `emailVerifiedAt` DATETIME(3) NULL,
    ADD COLUMN `passwordChangedAt` DATETIME(3) NULL,
    ADD COLUMN `totpEnabledAt` DATETIME(3) NULL,
    ADD COLUMN `totpSecret` TEXT NULL;

-- CreateTable
CREATE TABLE `user_email_otps` (
    `id` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `purpose` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_email_otps_userId_purpose_createdAt_idx`(`userId`, `purpose`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `download_logs` (
    `id` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `page` VARCHAR(191) NULL,
    `reason` TEXT NOT NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `serverRoute` TEXT NULL,
    `servedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `download_logs_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `download_logs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `users_email_key` ON `users`(`email`);

-- AddForeignKey
ALTER TABLE `user_email_otps` ADD CONSTRAINT `user_email_otps_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `download_logs` ADD CONSTRAINT `download_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
