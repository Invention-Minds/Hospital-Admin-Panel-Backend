-- CreateTable
CREATE TABLE `PatientDetails` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prn` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `foreignNational` BOOLEAN NULL,
    `contactNo` VARCHAR(191) NULL,
    `mobileNo` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `age` INTEGER NULL,
    `gender` INTEGER NULL,
    `address` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,
    `district` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `area` VARCHAR(191) NULL,
    `pin` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PatientDetails_prn_key`(`prn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
