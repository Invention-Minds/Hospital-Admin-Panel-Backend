-- CreateTable
CREATE TABLE `ServiceAppointments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pnrNumber` VARCHAR(191) NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NULL,
    `phoneNumber` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `appointmentDate` VARCHAR(191) NOT NULL,
    `appointmentTime` VARCHAR(191) NULL,
    `requestVia` VARCHAR(191) NOT NULL,
    `appointmentStatus` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `checkedIn` BOOLEAN NULL DEFAULT false,
    `lockedBy` INTEGER NULL,
    `userId` INTEGER NULL,
    `username` VARCHAR(191) NULL,
    `role` ENUM('super_admin', 'sub_admin', 'admin', 'doctor', 'unknown') NULL,
    `checkedInTime` DATETIME(3) NULL,
    `checkedOut` BOOLEAN NULL,
    `checkedOutTime` DATETIME(3) NULL,
    `age` INTEGER NULL,
    `gender` VARCHAR(191) NULL,
    `radioServiceId` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ServiceAppointments` ADD CONSTRAINT `ServiceAppointments_radioServiceId_fkey` FOREIGN KEY (`radioServiceId`) REFERENCES `RadioService`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
