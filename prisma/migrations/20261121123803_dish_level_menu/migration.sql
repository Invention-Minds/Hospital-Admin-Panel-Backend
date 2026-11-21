-- CreateTable
CREATE TABLE `Dish` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `swapGroup` VARCHAR(191) NULL,
    `portion` VARCHAR(191) NULL,
    `isVeg` BOOLEAN NOT NULL DEFAULT true,
    `caloriesKcal` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Dish_name_key`(`name`),
    INDEX `Dish_swapGroup_idx`(`swapGroup`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DishDiet` (
    `id` VARCHAR(191) NOT NULL,
    `dishId` VARCHAR(191) NOT NULL,
    `dietMasterId` VARCHAR(191) NOT NULL,

    INDEX `DishDiet_dietMasterId_idx`(`dietMasterId`),
    UNIQUE INDEX `DishDiet_dishId_dietMasterId_key`(`dishId`, `dietMasterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealDish` (
    `id` VARCHAR(191) NOT NULL,
    `mealMasterId` VARCHAR(191) NOT NULL,
    `dishId` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `MealDish_dishId_idx`(`dishId`),
    UNIQUE INDEX `MealDish_mealMasterId_dishId_key`(`mealMasterId`, `dishId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealOrderItem` (
    `id` VARCHAR(191) NOT NULL,
    `mealOrderId` VARCHAR(191) NOT NULL,
    `defaultDishId` VARCHAR(191) NOT NULL,
    `dishId` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `omitted` BOOLEAN NOT NULL DEFAULT false,
    `changedAt` DATETIME(3) NULL,
    `changedBy` VARCHAR(191) NULL,
    `changedLate` BOOLEAN NOT NULL DEFAULT false,

    INDEX `MealOrderItem_dishId_idx`(`dishId`),
    UNIQUE INDEX `MealOrderItem_mealOrderId_defaultDishId_key`(`mealOrderId`, `defaultDishId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DishDiet` ADD CONSTRAINT `DishDiet_dishId_fkey` FOREIGN KEY (`dishId`) REFERENCES `Dish`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DishDiet` ADD CONSTRAINT `DishDiet_dietMasterId_fkey` FOREIGN KEY (`dietMasterId`) REFERENCES `DietMaster`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealDish` ADD CONSTRAINT `MealDish_mealMasterId_fkey` FOREIGN KEY (`mealMasterId`) REFERENCES `MealMaster`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealDish` ADD CONSTRAINT `MealDish_dishId_fkey` FOREIGN KEY (`dishId`) REFERENCES `Dish`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealOrderItem` ADD CONSTRAINT `MealOrderItem_mealOrderId_fkey` FOREIGN KEY (`mealOrderId`) REFERENCES `MealOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealOrderItem` ADD CONSTRAINT `MealOrderItem_dishId_fkey` FOREIGN KEY (`dishId`) REFERENCES `Dish`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
