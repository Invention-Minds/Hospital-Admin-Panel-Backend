-- CreateTable
CREATE TABLE `OtStaffMaster` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `employeeCode` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL,
    `designation` VARCHAR(191) NULL,
    `departmentId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    UNIQUE INDEX `OtStaffMaster_employeeCode_key`(`employeeCode`),
    INDEX `OtStaffMaster_role_idx`(`role`),
    INDEX `OtStaffMaster_departmentId_idx`(`departmentId`),
    INDEX `OtStaffMaster_isActive_idx`(`isActive`),
    INDEX `OtStaffMaster_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SurgeryProcedureMaster` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NULL,
    `departmentId` INTEGER NULL,
    `categoryCode` VARCHAR(191) NULL,
    `surgeryType` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    UNIQUE INDEX `SurgeryProcedureMaster_code_key`(`code`),
    INDEX `SurgeryProcedureMaster_departmentId_idx`(`departmentId`),
    INDEX `SurgeryProcedureMaster_categoryCode_idx`(`categoryCode`),
    INDEX `SurgeryProcedureMaster_isActive_idx`(`isActive`),
    INDEX `SurgeryProcedureMaster_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
