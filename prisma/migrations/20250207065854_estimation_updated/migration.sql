-- AlterTable
ALTER TABLE `estimation_details` ADD COLUMN `cancellationDateAndTime` DATETIME(3) NULL,
    ADD COLUMN `completedDateAndTime` DATETIME(3) NULL,
    ADD COLUMN `confirmedDateAndTime` DATETIME(3) NULL;
