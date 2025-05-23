-- CreateTable
CREATE TABLE `HistoryNotes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prn` INTEGER NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `medicalHistory` TEXT NULL,
    `familyHistory` TEXT NULL,
    `socialHistory` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
