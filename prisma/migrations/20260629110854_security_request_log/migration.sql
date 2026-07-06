-- CreateTable
CREATE TABLE `SecurityRequestLog` (
    `id` VARCHAR(191) NOT NULL,
    `method` VARCHAR(191) NOT NULL,
    `path` TEXT NOT NULL,
    `statusCode` INTEGER NOT NULL,
    `responseMs` INTEGER NOT NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `userId` INTEGER NULL,
    `anonymous` BOOLEAN NOT NULL DEFAULT true,
    `suspicious` BOOLEAN NOT NULL DEFAULT false,
    `threatRules` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SecurityRequestLog_createdAt_idx`(`createdAt`),
    INDEX `SecurityRequestLog_ip_idx`(`ip`),
    INDEX `SecurityRequestLog_suspicious_idx`(`suspicious`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
