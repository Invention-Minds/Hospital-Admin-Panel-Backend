/*
  Warnings:

  - You are about to drop the column `package` on the `Service` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE `Package` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Package_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Step 1: Create the new `packageId` column without a NOT NULL constraint
ALTER TABLE `Service`
    ADD COLUMN `packageId` INTEGER NULL;

-- Step 2: Populate the `Package` table with distinct `package` values
INSERT INTO `Package` (`name`, `description`)
SELECT DISTINCT `package`, 'Migrated package' FROM `Service`
WHERE `package` IS NOT NULL;

-- Step 3: Update the `Service` table to reference the `Package` table
UPDATE `Service` s
JOIN `Package` p ON s.`package` = p.`name`
SET s.`packageId` = p.`id`;

-- Step 4: Alter the `packageId` column to NOT NULL (now safe)
ALTER TABLE `Service`
    MODIFY COLUMN `packageId` INTEGER NOT NULL;

-- Step 5: Add the foreign key constraint
ALTER TABLE `Service` ADD CONSTRAINT `Service_packageId_fkey` FOREIGN KEY (`packageId`) REFERENCES `Package`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Step 6: Drop the old `package` column
ALTER TABLE `Service` DROP COLUMN `package`;
