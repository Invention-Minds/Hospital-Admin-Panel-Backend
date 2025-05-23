-- AlterTable
ALTER TABLE `PatientDetails` ADD COLUMN `BPd` VARCHAR(191) NULL,
    ADD COLUMN `BPs` VARCHAR(191) NULL,
    ADD COLUMN `RR` VARCHAR(191) NULL,
    ADD COLUMN `bloodGroup` VARCHAR(191) NULL,
    ADD COLUMN `diagnosis` VARCHAR(191) NULL,
    ADD COLUMN `dob` VARCHAR(191) NULL,
    ADD COLUMN `hb` VARCHAR(191) NULL,
    ADD COLUMN `height` VARCHAR(191) NULL,
    ADD COLUMN `patientType` VARCHAR(191) NULL,
    ADD COLUMN `pulse` VARCHAR(191) NULL,
    ADD COLUMN `rh` VARCHAR(191) NULL,
    ADD COLUMN `sFerritin` VARCHAR(191) NULL,
    ADD COLUMN `spo2` VARCHAR(191) NULL,
    ADD COLUMN `temp` VARCHAR(191) NULL,
    ADD COLUMN `weight` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Prescription` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prescriptionId` VARCHAR(191) NOT NULL,
    `prescribedBy` VARCHAR(191) NOT NULL,
    `prescribedDate` VARCHAR(191) NOT NULL,
    `prn` VARCHAR(191) NOT NULL,
    `patientName` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Prescription_prescriptionId_key`(`prescriptionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tablet` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `genericName` VARCHAR(191) NOT NULL,
    `brandName` VARCHAR(191) NOT NULL,
    `frequency` VARCHAR(191) NOT NULL,
    `duration` VARCHAR(191) NOT NULL,
    `instructions` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `prescriptionId` VARCHAR(191) NOT NULL,
    `route` VARCHAR(191) NULL DEFAULT 'oral',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Tablet_prescriptionId_fkey`(`prescriptionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TabletMaster` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `genericName` VARCHAR(191) NOT NULL,
    `brandName` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FavoriteTablet` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `tabletId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `duration` VARCHAR(191) NULL,
    `frequency` VARCHAR(191) NULL,
    `instructions` VARCHAR(191) NULL,

    INDEX `FavoriteTablet_tabletId_fkey`(`tabletId`),
    UNIQUE INDEX `FavoriteTablet_userId_tabletId_key`(`userId`, `tabletId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Allergy` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prn` VARCHAR(191) NOT NULL,
    `genericName` VARCHAR(191) NOT NULL,
    `notedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DoctorNote` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prn` INTEGER NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `chiefComplaints` TEXT NULL,
    `diagnosis` TEXT NULL,
    `generalExamination` TEXT NULL,
    `clinicalNotes` TEXT NULL,
    `advice` TEXT NULL,
    `cvs` TEXT NULL,
    `rs` TEXT NULL,
    `cns` TEXT NULL,
    `pa` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Tablet` ADD CONSTRAINT `Tablet_prescriptionId_fkey` FOREIGN KEY (`prescriptionId`) REFERENCES `Prescription`(`prescriptionId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FavoriteTablet` ADD CONSTRAINT `FavoriteTablet_tabletId_fkey` FOREIGN KEY (`tabletId`) REFERENCES `TabletMaster`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
