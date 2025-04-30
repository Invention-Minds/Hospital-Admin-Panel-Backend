-- CreateTable
CREATE TABLE `BloodGroup` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BloodGroup_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BloodGroupAppointment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pnrNumber` VARCHAR(191) NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NULL,
    `phoneNumber` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `appointmentDate` VARCHAR(191) NOT NULL,
    `appointmentSlot` VARCHAR(191) NULL,
    `repeatChecked` BOOLEAN NOT NULL DEFAULT false,
    `daysInterval` INTEGER NULL,
    `numberOfTimes` INTEGER NULL,
    `requestVia` VARCHAR(191) NOT NULL,
    `appointmentStatus` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `checkedIn` BOOLEAN NULL DEFAULT false,
    `emailSent` BOOLEAN NULL DEFAULT false,
    `messageSent` BOOLEAN NULL DEFAULT false,
    `smsSent` BOOLEAN NULL DEFAULT false,
    `bloodGroupId` INTEGER NOT NULL,
    `lockedBy` INTEGER NULL,
    `userId` INTEGER NULL,
    `username` VARCHAR(191) NULL,
    `role` ENUM('super_admin', 'sub_admin', 'admin', 'doctor', 'unknown') NULL,
    `checkedInTime` DATETIME(3) NULL,
    `age` VARCHAR(191) NULL,
    `gender` VARCHAR(191) NULL,
    `prefix` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BloodGroupRepeatedDate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` VARCHAR(191) NOT NULL,
    `bloodGroupAppointmentId` INTEGER NOT NULL,

    INDEX `BloodGroupRepeatedDate_appointmentId_fkey`(`bloodGroupAppointmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BloodGroupAppointment` ADD CONSTRAINT `BloodGroupAppointment_bloodGroupId_fkey` FOREIGN KEY (`bloodGroupId`) REFERENCES `BloodGroup`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BloodGroupRepeatedDate` ADD CONSTRAINT `BloodGroupRepeatedDate_bloodGroupAppointmentId_fkey` FOREIGN KEY (`bloodGroupAppointmentId`) REFERENCES `BloodGroupAppointment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
