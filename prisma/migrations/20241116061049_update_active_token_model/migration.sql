-- AlterTable
ALTER TABLE `active_tokens` MODIFY `loggedInAt` VARCHAR(191) NOT NULL,
    MODIFY `lastActive` VARCHAR(191) NOT NULL;
