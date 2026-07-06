-- AlterTable
ALTER TABLE `OtStaffMaster` ADD COLUMN `userId` INTEGER NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `dateOfBirth` DATETIME(3) NULL,
    ADD COLUMN `designation` VARCHAR(191) NULL,
    ADD COLUMN `fullName` VARCHAR(191) NULL,
    ADD COLUMN `joiningDate` DATETIME(3) NULL,
    ADD COLUMN `phoneNumber` VARCHAR(191) NULL,
    ADD COLUMN `primaryWardId` VARCHAR(191) NULL,
    ADD COLUMN `qualification` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `OtStaffMaster_userId_idx` ON `OtStaffMaster`(`userId`);

-- CreateIndex
CREATE INDEX `users_primaryWardId_idx` ON `users`(`primaryWardId`);

-- CreateIndex
CREATE INDEX `users_subAdminType_idx` ON `users`(`subAdminType`);

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_primaryWardId_fkey` FOREIGN KEY (`primaryWardId`) REFERENCES `IpdWard`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OtStaffMaster` ADD CONSTRAINT `OtStaffMaster_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
