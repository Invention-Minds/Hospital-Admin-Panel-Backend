-- CreateTable
CREATE TABLE `LeaveDates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `doctorId` INTEGER NULL,
    `date` DATETIME(3) NOT NULL,

    INDEX `LeaveDates_doctorId_fkey`(`doctorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LeaveDates` ADD CONSTRAINT `LeaveDates_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
