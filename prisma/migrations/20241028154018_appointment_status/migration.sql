-- AlterTable
ALTER TABLE `appointments` MODIFY `status` ENUM('pending', 'confirmed', 'cancelled', 'completed', 'rescheduled') NOT NULL DEFAULT 'pending';
