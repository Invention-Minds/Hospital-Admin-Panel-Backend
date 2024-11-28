-- DropForeignKey
ALTER TABLE `ExtraSlot` DROP FOREIGN KEY `ExtraSlot_doctorId_fkey`;

-- AlterTable
ALTER TABLE `ExtraSlot` MODIFY `doctorId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `ExtraSlot` ADD CONSTRAINT `ExtraSlot_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
