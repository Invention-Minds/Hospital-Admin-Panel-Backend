-- CreateTable
CREATE TABLE `Lab` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `description` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Radiology` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `description` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InvestigationOrder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prn` VARCHAR(191) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `doctorId` INTEGER NOT NULL,
    `doctorName` VARCHAR(191) NOT NULL,
    `remarks` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_InvestigationOrderToLab` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_InvestigationOrderToLab_AB_unique`(`A`, `B`),
    INDEX `_InvestigationOrderToLab_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_InvestigationOrderToRadiology` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_InvestigationOrderToRadiology_AB_unique`(`A`, `B`),
    INDEX `_InvestigationOrderToRadiology_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_InvestigationOrderToPackage` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_InvestigationOrderToPackage_AB_unique`(`A`, `B`),
    INDEX `_InvestigationOrderToPackage_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `_InvestigationOrderToLab` ADD CONSTRAINT `_InvestigationOrderToLab_A_fkey` FOREIGN KEY (`A`) REFERENCES `InvestigationOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_InvestigationOrderToLab` ADD CONSTRAINT `_InvestigationOrderToLab_B_fkey` FOREIGN KEY (`B`) REFERENCES `Lab`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_InvestigationOrderToRadiology` ADD CONSTRAINT `_InvestigationOrderToRadiology_A_fkey` FOREIGN KEY (`A`) REFERENCES `InvestigationOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_InvestigationOrderToRadiology` ADD CONSTRAINT `_InvestigationOrderToRadiology_B_fkey` FOREIGN KEY (`B`) REFERENCES `Radiology`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_InvestigationOrderToPackage` ADD CONSTRAINT `_InvestigationOrderToPackage_A_fkey` FOREIGN KEY (`A`) REFERENCES `InvestigationOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_InvestigationOrderToPackage` ADD CONSTRAINT `_InvestigationOrderToPackage_B_fkey` FOREIGN KEY (`B`) REFERENCES `Package`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
