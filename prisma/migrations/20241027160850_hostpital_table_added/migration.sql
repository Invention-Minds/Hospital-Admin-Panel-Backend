-- CreateTable
CREATE TABLE `Hospital` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hospital_name` VARCHAR(191) NOT NULL,
    `hospital_email` VARCHAR(191) NOT NULL,
    `hospital_phone` VARCHAR(191) NOT NULL,
    `hospital_whatsapp_number` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `Hospital_hospital_name_key`(`hospital_name`),
    UNIQUE INDEX `Hospital_hospital_email_key`(`hospital_email`),
    UNIQUE INDEX `Hospital_hospital_phone_key`(`hospital_phone`),
    UNIQUE INDEX `Hospital_hospital_whatsapp_number_key`(`hospital_whatsapp_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
