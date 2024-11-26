-- CreateTable
CREATE TABLE `ExtraSlot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `doctorId` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `time` VARCHAR(191) NOT NULL,

    INDEX `unique_slot`(`doctorId`, `date`, `time`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ExtraSlot` ADD CONSTRAINT `ExtraSlot_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
