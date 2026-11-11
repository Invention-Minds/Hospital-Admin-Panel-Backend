-- AlterTable
ALTER TABLE `FeedbackConfig` ADD COLUMN `googleReviewUrl` TEXT NULL;

-- AlterTable
ALTER TABLE `FeedbackSurvey` ADD COLUMN `reviewClickedAt` DATETIME(3) NULL;
