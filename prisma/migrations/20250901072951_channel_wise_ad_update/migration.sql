-- CreateTable
CREATE TABLE `_AdChannels` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_AdChannels_AB_unique`(`A`, `B`),
    INDEX `_AdChannels_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `_AdChannels` ADD CONSTRAINT `_AdChannels_A_fkey` FOREIGN KEY (`A`) REFERENCES `Advertisement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_AdChannels` ADD CONSTRAINT `_AdChannels_B_fkey` FOREIGN KEY (`B`) REFERENCES `Channel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
