-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `emailSent` BOOLEAN NULL DEFAULT false,
    MODIFY `status` ENUM('pending', 'confirmed', 'cancelled', 'completed') NOT NULL DEFAULT 'pending';
