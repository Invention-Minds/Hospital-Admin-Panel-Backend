-- AlterTable
ALTER TABLE `user` MODIFY `role` ENUM('super_admin', 'sub_admin', 'admin', 'doctor', 'unknown') NOT NULL;
