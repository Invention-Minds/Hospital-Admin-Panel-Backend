-- AlterTable
ALTER TABLE `TherapyAppointment` ADD COLUMN `courseId` INTEGER NULL,
    ADD COLUMN `dayNumber` INTEGER NULL;

-- CreateTable
CREATE TABLE `TherapyCourse` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prn` INTEGER NOT NULL,
    `prefix` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `gender` VARCHAR(191) NULL,
    `age` INTEGER NULL,
    `doctorId` INTEGER NULL,
    `totalDays` INTEGER NOT NULL,
    `startDate` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `remarks` VARCHAR(191) NULL,
    `lockedBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TherapyCourse_doctorId_idx`(`doctorId`),
    INDEX `TherapyCourse_prn_idx`(`prn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TherapyCoursePlanDay` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `dayNumber` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'planned',
    `plannedDate` VARCHAR(191) NOT NULL,
    `time` VARCHAR(191) NOT NULL,
    `roomNumber` VARCHAR(191) NOT NULL,
    `hasBathing` BOOLEAN NOT NULL DEFAULT false,
    `totalDurationMinutes` INTEGER NOT NULL,
    `plannedTherapistIds` JSON NOT NULL,
    `plannedTherapyIds` JSON NOT NULL,
    `appointmentId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TherapyCoursePlanDay_appointmentId_key`(`appointmentId`),
    INDEX `TherapyCoursePlanDay_plannedDate_idx`(`plannedDate`),
    UNIQUE INDEX `TherapyCoursePlanDay_courseId_dayNumber_key`(`courseId`, `dayNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TherapistShift` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `therapistId` INTEGER NOT NULL,
    `weekday` INTEGER NOT NULL,
    `startTime` VARCHAR(191) NOT NULL,
    `endTime` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TherapistShift_therapistId_weekday_idx`(`therapistId`, `weekday`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TherapistLeave` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `therapistId` INTEGER NOT NULL,
    `startDate` VARCHAR(191) NOT NULL,
    `endDate` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TherapistLeave_therapistId_idx`(`therapistId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `TherapyAppointment_courseId_idx` ON `TherapyAppointment`(`courseId`);

-- AddForeignKey
ALTER TABLE `TherapyAppointment` ADD CONSTRAINT `TherapyAppointment_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `TherapyCourse`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TherapyCourse` ADD CONSTRAINT `TherapyCourse_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TherapyCoursePlanDay` ADD CONSTRAINT `TherapyCoursePlanDay_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `TherapyCourse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TherapyCoursePlanDay` ADD CONSTRAINT `TherapyCoursePlanDay_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `TherapyAppointment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TherapistShift` ADD CONSTRAINT `TherapistShift_therapistId_fkey` FOREIGN KEY (`therapistId`) REFERENCES `Therapist`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TherapistLeave` ADD CONSTRAINT `TherapistLeave_therapistId_fkey` FOREIGN KEY (`therapistId`) REFERENCES `Therapist`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
