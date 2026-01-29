-- DropForeignKey
ALTER TABLE `TherapyAppointment` DROP FOREIGN KEY `TherapyAppointment_therapyId_fkey`;

-- AlterTable
ALTER TABLE `TherapyAppointment` MODIFY `therapyId` INTEGER NULL;

-- CreateTable
CREATE TABLE `TherapyAppointmentTherapy` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `appointmentId` INTEGER NOT NULL,
    `therapyId` INTEGER NOT NULL,

    UNIQUE INDEX `TherapyAppointmentTherapy_appointmentId_therapyId_key`(`appointmentId`, `therapyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TherapyAppointment` ADD CONSTRAINT `TherapyAppointment_therapyId_fkey` FOREIGN KEY (`therapyId`) REFERENCES `Therapy`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TherapyAppointmentTherapy` ADD CONSTRAINT `TherapyAppointmentTherapy_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `TherapyAppointment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TherapyAppointmentTherapy` ADD CONSTRAINT `TherapyAppointmentTherapy_therapyId_fkey` FOREIGN KEY (`therapyId`) REFERENCES `Therapy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
