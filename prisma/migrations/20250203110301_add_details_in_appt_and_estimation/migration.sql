-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `isAccepted` DATETIME(3) NULL,
    ADD COLUMN `isAcceptedCloseTime` DATETIME(3) NULL,
    ADD COLUMN `isCloseOPD` BOOLEAN NULL,
    ADD COLUMN `isCloseOPDTime` DATETIME(3) NULL,
    ADD COLUMN `timeGap` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `estimation_details` ADD COLUMN `surgeryTime` VARCHAR(191) NULL;
