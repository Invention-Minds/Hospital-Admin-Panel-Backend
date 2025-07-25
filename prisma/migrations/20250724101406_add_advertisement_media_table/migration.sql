-- CreateTable
CREATE TABLE `AdvertisementMedia` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `advertisementId` INTEGER NOT NULL,
    `url` TEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AdvertisementMedia` ADD CONSTRAINT `AdvertisementMedia_advertisementId_fkey` FOREIGN KEY (`advertisementId`) REFERENCES `Advertisement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
