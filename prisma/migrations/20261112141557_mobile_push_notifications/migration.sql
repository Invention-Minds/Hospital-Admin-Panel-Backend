-- CreateTable
CREATE TABLE `MobilePushDevice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `token` VARCHAR(255) NOT NULL,
    `platform` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `disabledAt` DATETIME(3) NULL,

    UNIQUE INDEX `MobilePushDevice_token_key`(`token`),
    INDEX `MobilePushDevice_userId_disabledAt_idx`(`userId`, `disabledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MobilePushLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventKey` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `devices` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,

    UNIQUE INDEX `MobilePushLog_eventKey_key`(`eventKey`),
    INDEX `MobilePushLog_userId_sentAt_idx`(`userId`, `sentAt`),
    INDEX `MobilePushLog_kind_sentAt_idx`(`kind`, `sentAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
