-- AlterTable
ALTER TABLE `Complaint` ADD COLUMN `department` VARCHAR(191) NULL,
    ADD COLUMN `raisedById` INTEGER NULL;

-- CreateTable
CREATE TABLE `FeedbackWalkUpOtp` (
    `id` VARCHAR(191) NOT NULL,
    `patientPrn` VARCHAR(191) NOT NULL,
    `phoneLast4` VARCHAR(191) NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `verifiedAt` DATETIME(3) NULL,
    `consumedAt` DATETIME(3) NULL,
    `requestIp` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FeedbackWalkUpOtp_patientPrn_createdAt_idx`(`patientPrn`, `createdAt`),
    INDEX `FeedbackWalkUpOtp_requestIp_createdAt_idx`(`requestIp`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Complaint_department_idx` ON `Complaint`(`department`);

-- CreateIndex
CREATE INDEX `Complaint_raisedById_idx` ON `Complaint`(`raisedById`);

-- CreateIndex
CREATE INDEX `Complaint_assignedToId_idx` ON `Complaint`(`assignedToId`);

-- CreateIndex
CREATE INDEX `Complaint_slaDueAt_escalatedAt_idx` ON `Complaint`(`slaDueAt`, `escalatedAt`);

-- CreateIndex
CREATE INDEX `FeedbackSurvey_appointmentId_idx` ON `FeedbackSurvey`(`appointmentId`);

-- CreateIndex
CREATE INDEX `FeedbackSurvey_admissionId_idx` ON `FeedbackSurvey`(`admissionId`);

-- CreateIndex
CREATE INDEX `FeedbackSurvey_emergencyId_idx` ON `FeedbackSurvey`(`emergencyId`);

-- CreateIndex
CREATE INDEX `FeedbackSurvey_status_expiresAt_idx` ON `FeedbackSurvey`(`status`, `expiresAt`);
