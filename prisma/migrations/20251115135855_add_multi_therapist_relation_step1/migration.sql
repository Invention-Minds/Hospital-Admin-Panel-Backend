-- DropForeignKey
ALTER TABLE `TherapyAppointment` DROP FOREIGN KEY `TherapyAppointment_therapistId_fkey`;

-- DropIndex
DROP INDEX `unique_therapist_slot` ON `TherapyAppointment`;

-- CreateTable
CREATE TABLE `TherapyAppointmentTherapist` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `appointmentId` INTEGER NOT NULL,
    `therapistId` INTEGER NOT NULL,

    UNIQUE INDEX `TherapyAppointmentTherapist_appointmentId_therapistId_key`(`appointmentId`, `therapistId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TherapyAppointmentTherapist` ADD CONSTRAINT `TherapyAppointmentTherapist_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `TherapyAppointment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TherapyAppointmentTherapist` ADD CONSTRAINT `TherapyAppointmentTherapist_therapistId_fkey` FOREIGN KEY (`therapistId`) REFERENCES `Therapist`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
