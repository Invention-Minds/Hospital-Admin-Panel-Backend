-- CreateTable
CREATE TABLE `ot_details` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `estimationId` VARCHAR(191) NOT NULL,
    `roomNo` VARCHAR(191) NOT NULL,
    `handledBy` VARCHAR(191) NOT NULL,
    `startedTime` DATETIME(3) NULL,
    `endedTime` DATETIME(3) NULL,
    `isStarted` BOOLEAN NOT NULL DEFAULT false,
    `isEnded` BOOLEAN NOT NULL DEFAULT false,
    `remarks` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ot_details` ADD CONSTRAINT `ot_details_estimationId_fkey` FOREIGN KEY (`estimationId`) REFERENCES `estimation_details`(`estimationId`) ON DELETE CASCADE ON UPDATE CASCADE;
