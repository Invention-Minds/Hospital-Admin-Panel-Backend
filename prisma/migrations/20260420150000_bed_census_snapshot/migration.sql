-- Sprint 4a · Phase 1e — Bed Census Daily snapshot table.
-- Additive only: new table, no changes to existing rows. Per "no drop, no rewrite" policy.

-- CreateTable
CREATE TABLE `BedCensusSnapshot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `snapshotDate` DATETIME(3) NOT NULL,
    `snapshotTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `wardId` VARCHAR(191) NOT NULL,
    `wardName` VARCHAR(191) NOT NULL,
    `wardCode` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NOT NULL,
    `totalBeds` INTEGER NOT NULL,
    `occupiedBeds` INTEGER NOT NULL,
    `availableBeds` INTEGER NOT NULL,
    `maintenanceBeds` INTEGER NOT NULL,
    `reservedBeds` INTEGER NOT NULL,
    `generalBeds` INTEGER NOT NULL DEFAULT 0,
    `icuBeds` INTEGER NOT NULL DEFAULT 0,
    `hduBeds` INTEGER NOT NULL DEFAULT 0,
    `isolationBeds` INTEGER NOT NULL DEFAULT 0,
    `snapshotReason` VARCHAR(191) NOT NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BedCensusSnapshot_snapshotDate_idx`(`snapshotDate`),
    INDEX `BedCensusSnapshot_wardId_idx`(`wardId`),
    INDEX `BedCensusSnapshot_snapshotReason_idx`(`snapshotReason`),
    UNIQUE INDEX `BedCensusSnapshot_snapshotDate_wardId_key`(`snapshotDate`, `wardId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
