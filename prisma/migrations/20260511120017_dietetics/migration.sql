-- CreateTable
CREATE TABLE `MealTimeSlot` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `startTime` VARCHAR(191) NOT NULL,
    `endTime` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MealTimeSlot_name_key`(`name`),
    UNIQUE INDEX `MealTimeSlot_code_key`(`code`),
    INDEX `MealTimeSlot_sequence_idx`(`sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AllergenMaster` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AllergenMaster_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DietMaster` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `caloriesKcal` INTEGER NULL,
    `proteinG` DOUBLE NULL,
    `carbsG` DOUBLE NULL,
    `fatG` DOUBLE NULL,
    `sodiumMg` DOUBLE NULL,
    `potassiumMg` DOUBLE NULL,
    `fluidMl` INTEGER NULL,
    `restrictions` TEXT NULL,
    `isVeg` BOOLEAN NOT NULL DEFAULT false,
    `isJain` BOOLEAN NOT NULL DEFAULT false,
    `isHalal` BOOLEAN NOT NULL DEFAULT false,
    `isKosher` BOOLEAN NOT NULL DEFAULT false,
    `isNoOnionGarlic` BOOLEAN NOT NULL DEFAULT false,
    `targetConditions` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    UNIQUE INDEX `DietMaster_name_key`(`name`),
    UNIQUE INDEX `DietMaster_code_key`(`code`),
    INDEX `DietMaster_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealMaster` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(191) NULL,
    `caloriesKcal` INTEGER NULL,
    `isVeg` BOOLEAN NOT NULL DEFAULT true,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MealMaster_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DietMealCompat` (
    `id` VARCHAR(191) NOT NULL,
    `dietMasterId` VARCHAR(191) NOT NULL,
    `mealMasterId` VARCHAR(191) NOT NULL,

    INDEX `DietMealCompat_mealMasterId_idx`(`mealMasterId`),
    UNIQUE INDEX `DietMealCompat_dietMasterId_mealMasterId_key`(`dietMasterId`, `mealMasterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealAllergen` (
    `id` VARCHAR(191) NOT NULL,
    `mealMasterId` VARCHAR(191) NOT NULL,
    `allergenId` VARCHAR(191) NOT NULL,

    INDEX `MealAllergen_allergenId_idx`(`allergenId`),
    UNIQUE INDEX `MealAllergen_mealMasterId_allergenId_key`(`mealMasterId`, `allergenId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MenuPlan` (
    `id` VARCHAR(191) NOT NULL,
    `dietMasterId` VARCHAR(191) NOT NULL,
    `mealTimeSlotId` VARCHAR(191) NOT NULL,
    `mealMasterId` VARCHAR(191) NOT NULL,
    `dayOfWeek` INTEGER NOT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MenuPlan_dietMasterId_idx`(`dietMasterId`),
    UNIQUE INDEX `MenuPlan_dietMasterId_mealTimeSlotId_dayOfWeek_key`(`dietMasterId`, `mealTimeSlotId`, `dayOfWeek`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DietPlan` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `dietMasterId` VARCHAR(191) NOT NULL,
    `startDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endDate` DATETIME(3) NULL,
    `npoUntil` DATETIME(3) NULL,
    `restrictionsSnapshot` LONGTEXT NULL,
    `allergensSnapshot` LONGTEXT NULL,
    `notesForKitchen` TEXT NULL,
    `noteTemplateId` VARCHAR(191) NULL,
    `templatedValues` LONGTEXT NULL,
    `signedAt` DATETIME(3) NULL,
    `signedBy` VARCHAR(191) NULL,
    `signedById` INTEGER NULL,
    `signatureId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `reassessmentReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    INDEX `DietPlan_admissionId_status_idx`(`admissionId`, `status`),
    INDEX `DietPlan_status_idx`(`status`),
    INDEX `DietPlan_signedAt_idx`(`signedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealOrder` (
    `id` VARCHAR(191) NOT NULL,
    `admissionId` VARCHAR(191) NOT NULL,
    `dietPlanId` VARCHAR(191) NOT NULL,
    `mealTimeSlotId` VARCHAR(191) NOT NULL,
    `mealMasterId` VARCHAR(191) NULL,
    `scheduledFor` DATETIME(3) NOT NULL,
    `wardId` VARCHAR(191) NULL,
    `bedId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ORDERED',
    `platedAt` DATETIME(3) NULL,
    `platedBy` VARCHAR(191) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `deliveredBy` VARCHAR(191) NULL,
    `kitchenNotes` TEXT NULL,
    `skipReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MealOrder_scheduledFor_status_idx`(`scheduledFor`, `status`),
    INDEX `MealOrder_wardId_scheduledFor_idx`(`wardId`, `scheduledFor`),
    INDEX `MealOrder_status_idx`(`status`),
    UNIQUE INDEX `MealOrder_admissionId_mealTimeSlotId_scheduledFor_key`(`admissionId`, `mealTimeSlotId`, `scheduledFor`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `mealOrderId` VARCHAR(191) NOT NULL,
    `deliveredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deliveredBy` VARCHAR(191) NULL,
    `deliveredById` INTEGER NULL,
    `signatureId` VARCHAR(191) NULL,
    `twoIdVerified` BOOLEAN NOT NULL DEFAULT false,
    `trayHotTempC` DOUBLE NULL,
    `trayColdTempC` DOUBLE NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MealDelivery_mealOrderId_key`(`mealOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealIntake` (
    `id` VARCHAR(191) NOT NULL,
    `mealOrderId` VARCHAR(191) NOT NULL,
    `percentConsumed` INTEGER NOT NULL,
    `complaint` TEXT NULL,
    `notes` TEXT NULL,
    `negativeFlag` BOOLEAN NOT NULL DEFAULT false,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `recordedBy` VARCHAR(191) NULL,
    `recordedById` INTEGER NULL,

    UNIQUE INDEX `MealIntake_mealOrderId_key`(`mealOrderId`),
    INDEX `MealIntake_negativeFlag_idx`(`negativeFlag`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DrugFoodInteraction` (
    `id` VARCHAR(191) NOT NULL,
    `match` VARCHAR(191) NOT NULL,
    `severity` VARCHAR(191) NOT NULL DEFAULT 'info',
    `foodGuidance` TEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DrugFoodInteraction_match_idx`(`match`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CanteenChannel` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `viewSpec` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CanteenChannel_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DietMealCompat` ADD CONSTRAINT `DietMealCompat_dietMasterId_fkey` FOREIGN KEY (`dietMasterId`) REFERENCES `DietMaster`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DietMealCompat` ADD CONSTRAINT `DietMealCompat_mealMasterId_fkey` FOREIGN KEY (`mealMasterId`) REFERENCES `MealMaster`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealAllergen` ADD CONSTRAINT `MealAllergen_mealMasterId_fkey` FOREIGN KEY (`mealMasterId`) REFERENCES `MealMaster`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealAllergen` ADD CONSTRAINT `MealAllergen_allergenId_fkey` FOREIGN KEY (`allergenId`) REFERENCES `AllergenMaster`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MenuPlan` ADD CONSTRAINT `MenuPlan_dietMasterId_fkey` FOREIGN KEY (`dietMasterId`) REFERENCES `DietMaster`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MenuPlan` ADD CONSTRAINT `MenuPlan_mealTimeSlotId_fkey` FOREIGN KEY (`mealTimeSlotId`) REFERENCES `MealTimeSlot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MenuPlan` ADD CONSTRAINT `MenuPlan_mealMasterId_fkey` FOREIGN KEY (`mealMasterId`) REFERENCES `MealMaster`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DietPlan` ADD CONSTRAINT `DietPlan_dietMasterId_fkey` FOREIGN KEY (`dietMasterId`) REFERENCES `DietMaster`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealOrder` ADD CONSTRAINT `MealOrder_dietPlanId_fkey` FOREIGN KEY (`dietPlanId`) REFERENCES `DietPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealOrder` ADD CONSTRAINT `MealOrder_mealTimeSlotId_fkey` FOREIGN KEY (`mealTimeSlotId`) REFERENCES `MealTimeSlot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealOrder` ADD CONSTRAINT `MealOrder_mealMasterId_fkey` FOREIGN KEY (`mealMasterId`) REFERENCES `MealMaster`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealDelivery` ADD CONSTRAINT `MealDelivery_mealOrderId_fkey` FOREIGN KEY (`mealOrderId`) REFERENCES `MealOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealIntake` ADD CONSTRAINT `MealIntake_mealOrderId_fkey` FOREIGN KEY (`mealOrderId`) REFERENCES `MealOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
