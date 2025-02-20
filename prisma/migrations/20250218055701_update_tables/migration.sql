-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `nameChangedBy` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `estimation_details` ADD COLUMN `implants` VARCHAR(191) NULL,
    ADD COLUMN `instrumentals` VARCHAR(191) NULL,
    ADD COLUMN `multipleSurgeries` VARCHAR(191) NULL,
    ADD COLUMN `procedures` VARCHAR(191) NULL;
