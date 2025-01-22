-- AlterTable
ALTER TABLE `Service` ADD COLUMN `role` ENUM('super_admin', 'sub_admin', 'admin', 'doctor', 'unknown') NULL,
    ADD COLUMN `username` VARCHAR(191) NULL;
