-- CreateTable
CREATE TABLE `estimation_details` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `estimationId` VARCHAR(191) NOT NULL,
    `patientName` VARCHAR(191) NOT NULL,
    `patientPhoneNumber` VARCHAR(191) NOT NULL,
    `patientUHID` VARCHAR(191) NULL,
    `ageOfPatient` INTEGER NULL,
    `genderOfPatient` VARCHAR(191) NULL,
    `consultantId` INTEGER NOT NULL,
    `consultantName` VARCHAR(191) NOT NULL,
    `estimationName` VARCHAR(191) NOT NULL,
    `estimationPreferredDate` VARCHAR(191) NOT NULL,
    `remarks` VARCHAR(191) NULL,
    `totalDaysStay` INTEGER NULL,
    `icuStay` INTEGER NULL,
    `wardStay` INTEGER NULL,
    `roomType` VARCHAR(191) NULL,
    `estimatedDate` VARCHAR(191) NULL,
    `estimationCost` INTEGER NULL,
    `discountPercentage` INTEGER NULL,
    `totalEstimationAmount` INTEGER NULL,
    `advanceAmountPaid` INTEGER NULL,
    `receiptNumber` VARCHAR(191) NULL,
    `employeeId` VARCHAR(191) NULL,
    `approverId` VARCHAR(191) NULL,
    `patientSign` VARCHAR(191) NULL,
    `employeeSign` VARCHAR(191) NULL,
    `approverSign` VARCHAR(191) NULL,
    `approvedDateAndTime` DATETIME(3) NULL,
    `estimationCreatedTime` DATETIME(3) NULL,
    `messageSentDateAndTime` DATETIME(3) NULL,
    `pdfLink` VARCHAR(191) NULL,
    `pacDone` BOOLEAN NULL,
    `statusOfEstimation` VARCHAR(191) NULL,
    `ageBucketOfSurgery` INTEGER NULL,
    `estimationType` VARCHAR(191) NOT NULL,
    `messageSent` BOOLEAN NULL,

    UNIQUE INDEX `estimation_details_estimationId_key`(`estimationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `follow_up_date` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `remarks` VARCHAR(191) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `estimationId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inclusions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `description` VARCHAR(191) NOT NULL,
    `estimationId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exclusions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `description` VARCHAR(191) NOT NULL,
    `estimationId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `follow_up_date` ADD CONSTRAINT `follow_up_date_estimationId_fkey` FOREIGN KEY (`estimationId`) REFERENCES `estimation_details`(`estimationId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inclusions` ADD CONSTRAINT `inclusions_estimationId_fkey` FOREIGN KEY (`estimationId`) REFERENCES `estimation_details`(`estimationId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exclusions` ADD CONSTRAINT `exclusions_estimationId_fkey` FOREIGN KEY (`estimationId`) REFERENCES `estimation_details`(`estimationId`) ON DELETE RESTRICT ON UPDATE CASCADE;
