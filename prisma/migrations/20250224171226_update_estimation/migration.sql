-- AlterTable
ALTER TABLE `estimation_details` ADD COLUMN `costForDeluxe` VARCHAR(191) NULL,
    ADD COLUMN `costForGeneral` VARCHAR(191) NULL,
    ADD COLUMN `costForPresidential` VARCHAR(191) NULL,
    ADD COLUMN `costForPrivate` VARCHAR(191) NULL,
    ADD COLUMN `costForSemiPrivate` VARCHAR(191) NULL,
    ADD COLUMN `costForVip` VARCHAR(191) NULL,
    ADD COLUMN `selectedRoomCost` VARCHAR(191) NULL;
