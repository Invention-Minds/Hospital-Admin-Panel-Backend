-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `referredDept` VARCHAR(191) NULL,
    ADD COLUMN `referredDeptId` INTEGER NULL,
    ADD COLUMN `referredDoc` VARCHAR(191) NULL,
    ADD COLUMN `referredDocId` INTEGER NULL;
