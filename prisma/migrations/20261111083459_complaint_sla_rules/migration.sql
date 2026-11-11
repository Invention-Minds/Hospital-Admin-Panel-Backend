-- AlterTable
ALTER TABLE `Complaint` ADD COLUMN `category` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `ComplaintSlaRule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `unitId` INTEGER NULL,
    `category` VARCHAR(191) NULL,
    `severity` VARCHAR(191) NULL,
    `hours` INTEGER NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ComplaintSlaRule_unitId_category_severity_key`(`unitId`, `category`, `severity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Complaint_category_idx` ON `Complaint`(`category`);
