-- CreateTable
CREATE TABLE `FacilityEquipment` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NULL,
    `isCritical` BOOLEAN NOT NULL DEFAULT false,
    `location` VARCHAR(191) NULL,
    `department` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'operational',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FacilityEquipment_code_key`(`code`),
    INDEX `FacilityEquipment_isCritical_idx`(`isCritical`),
    INDEX `FacilityEquipment_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FacilityEquipmentEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `equipmentId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `dueAt` DATETIME(3) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,
    `performedBy` VARCHAR(191) NULL,
    `performedById` INTEGER NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FacilityEquipmentEvent_equipmentId_eventType_idx`(`equipmentId`, `eventType`),
    INDEX `FacilityEquipmentEvent_eventType_dueAt_idx`(`eventType`, `dueAt`),
    INDEX `FacilityEquipmentEvent_eventType_occurredAt_idx`(`eventType`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FacilityUtilityFailure` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `utilityType` VARCHAR(191) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `durationMinutes` INTEGER NULL,
    `affectedAreas` TEXT NULL,
    `notes` TEXT NULL,
    `reporter` VARCHAR(191) NULL,
    `reporterId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FacilityUtilityFailure_occurredAt_idx`(`occurredAt`),
    INDEX `FacilityUtilityFailure_utilityType_idx`(`utilityType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FacilityAmbulanceCall` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `calledAt` DATETIME(3) NOT NULL,
    `dispatchedAt` DATETIME(3) NULL,
    `arrivedAt` DATETIME(3) NULL,
    `responseTimeMinutes` INTEGER NULL,
    `withinTarget` BOOLEAN NOT NULL,
    `notes` TEXT NULL,
    `reporter` VARCHAR(191) NULL,
    `reporterId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FacilityAmbulanceCall_calledAt_idx`(`calledAt`),
    INDEX `FacilityAmbulanceCall_withinTarget_idx`(`withinTarget`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FacilityMaintenanceComplaint` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `raisedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `slaDueAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `closedAt` DATETIME(3) NULL,
    `closedBy` VARCHAR(191) NULL,
    `closedById` INTEGER NULL,
    `reporter` VARCHAR(191) NULL,
    `reporterId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FacilityMaintenanceComplaint_status_idx`(`status`),
    INDEX `FacilityMaintenanceComplaint_raisedAt_idx`(`raisedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `FacilityEquipmentEvent` ADD CONSTRAINT `FacilityEquipmentEvent_equipmentId_fkey` FOREIGN KEY (`equipmentId`) REFERENCES `FacilityEquipment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
