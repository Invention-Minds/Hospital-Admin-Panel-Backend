-- AlterTable
ALTER TABLE `MealTimeSlot` ADD COLUMN `departments` TEXT NULL;

-- CreateIndex
CREATE INDEX `BookedSlot_doctorId_fkey` ON `BookedSlot`(`doctorId`);

-- CreateIndex
CREATE INDEX `appointments_doctorId_fkey` ON `appointments`(`doctorId`);
