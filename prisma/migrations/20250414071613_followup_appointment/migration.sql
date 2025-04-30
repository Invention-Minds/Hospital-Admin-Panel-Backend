-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `isFollowupTime` DATETIME(3) NULL,
    ADD COLUMN `isfollowup` BOOLEAN NULL;
