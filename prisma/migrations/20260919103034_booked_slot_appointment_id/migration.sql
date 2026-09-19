-- AlterTable
ALTER TABLE `BookedSlot` ADD COLUMN `appointmentId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `BookedSlot_appointmentId_idx` ON `BookedSlot`(`appointmentId`);
