-- CreateTable
CREATE TABLE `Therapy` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `duration` INTEGER NOT NULL DEFAULT 75,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Therapy_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Therapist` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `phoneNumber` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `qualification` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Therapist_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TherapyAppointment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prn` INTEGER NOT NULL,
    `prefix` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `gender` VARCHAR(191) NULL,
    `age` INTEGER NULL,
    `doctorId` INTEGER NULL,
    `therapistId` INTEGER NULL,
    `therapyId` INTEGER NOT NULL,
    `roomNumber` VARCHAR(191) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `time` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NULL,
    `checkedIn` BOOLEAN NULL DEFAULT false,
    `checkedInTime` DATETIME(3) NULL,
    `checkedInBy` VARCHAR(191) NULL,
    `reminderSent` BOOLEAN NULL DEFAULT false,
    `reminderSentAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `startedBy` VARCHAR(191) NULL,
    `finishedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TherapyAppointment_doctorId_idx`(`doctorId`),
    INDEX `TherapyAppointment_therapistId_idx`(`therapistId`),
    INDEX `TherapyAppointment_therapyId_idx`(`therapyId`),
    UNIQUE INDEX `unique_therapy_room_slot`(`roomNumber`, `date`, `time`),
    UNIQUE INDEX `unique_therapist_slot`(`therapistId`, `date`, `time`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TherapyAppointment` ADD CONSTRAINT `TherapyAppointment_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TherapyAppointment` ADD CONSTRAINT `TherapyAppointment_therapistId_fkey` FOREIGN KEY (`therapistId`) REFERENCES `Therapist`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TherapyAppointment` ADD CONSTRAINT `TherapyAppointment_therapyId_fkey` FOREIGN KEY (`therapyId`) REFERENCES `Therapy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
