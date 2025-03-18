-- CreateTable
CREATE TABLE `Advertisement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(10) NOT NULL,
    `content` TEXT NOT NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
