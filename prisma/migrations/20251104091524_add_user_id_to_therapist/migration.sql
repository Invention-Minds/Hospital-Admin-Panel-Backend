-- AlterTable
ALTER TABLE `Therapist` ADD COLUMN `userId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `Therapist` ADD CONSTRAINT `Therapist_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
