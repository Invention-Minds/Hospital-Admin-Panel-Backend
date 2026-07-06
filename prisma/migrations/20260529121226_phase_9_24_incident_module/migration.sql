-- CreateTable
CREATE TABLE `Incident` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `severity` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `ruleKey` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` LONGTEXT NOT NULL,
    `patientPrn` VARCHAR(191) NULL,
    `patientName` VARCHAR(191) NULL,
    `admissionId` VARCHAR(191) NULL,
    `emergencyId` INTEGER NULL,
    `appointmentId` INTEGER NULL,
    `ward` VARCHAR(191) NULL,
    `department` VARCHAR(191) NULL,
    `occurredAt` DATETIME(3) NULL,
    `reportedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reportedBy` VARCHAR(191) NULL,
    `reportedById` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `severityFinal` VARCHAR(191) NULL,
    `nabhClause` VARCHAR(191) NULL,
    `evidenceLinks` LONGTEXT NULL,
    `triagedAt` DATETIME(3) NULL,
    `triagedBy` VARCHAR(191) NULL,
    `assignedTo` VARCHAR(191) NULL,
    `assignedToId` INTEGER NULL,
    `closedAt` DATETIME(3) NULL,
    `closedBy` VARCHAR(191) NULL,
    `closureNotes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Incident_code_key`(`code`),
    INDEX `Incident_status_idx`(`status`),
    INDEX `Incident_severity_idx`(`severity`),
    INDEX `Incident_patientPrn_idx`(`patientPrn`),
    INDEX `Incident_reportedAt_idx`(`reportedAt`),
    INDEX `Incident_category_status_idx`(`category`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IncidentCapa` (
    `id` VARCHAR(191) NOT NULL,
    `incidentId` VARCHAR(191) NOT NULL,
    `immediateActions` LONGTEXT NULL,
    `why1` TEXT NULL,
    `why2` TEXT NULL,
    `why3` TEXT NULL,
    `why4` TEXT NULL,
    `why5` TEXT NULL,
    `rootCause` TEXT NULL,
    `correctiveActions` LONGTEXT NULL,
    `preventiveActions` LONGTEXT NULL,
    `owner` VARCHAR(191) NULL,
    `ownerId` INTEGER NULL,
    `dueDate` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `effectivenessReview` LONGTEXT NULL,
    `effectivenessReviewAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `IncidentCapa_incidentId_key`(`incidentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IncidentRule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `defaultSeverity` VARCHAR(191) NOT NULL,
    `nabhClause` VARCHAR(191) NULL,
    `thresholdMinutes` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `IncidentRule_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeedbackSurvey` (
    `id` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `template` VARCHAR(191) NOT NULL,
    `patientPrn` VARCHAR(191) NULL,
    `patientName` VARCHAR(191) NULL,
    `appointmentId` INTEGER NULL,
    `admissionId` VARCHAR(191) NULL,
    `emergencyId` INTEGER NULL,
    `encounterDate` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `sentChannel` VARCHAR(191) NULL,
    `respondedAt` DATETIME(3) NULL,
    `respondedChannel` VARCHAR(191) NULL,
    `npsScore` INTEGER NULL,
    `satisfactionScores` LONGTEXT NULL,
    `comments` TEXT NULL,
    `complaintFlag` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FeedbackSurvey_token_key`(`token`),
    INDEX `FeedbackSurvey_template_status_idx`(`template`, `status`),
    INDEX `FeedbackSurvey_patientPrn_idx`(`patientPrn`),
    INDEX `FeedbackSurvey_respondedAt_idx`(`respondedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Complaint` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `patientPrn` VARCHAR(191) NULL,
    `patientName` VARCHAR(191) NULL,
    `raisedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `channel` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `feedbackSurveyId` VARCHAR(191) NULL,
    `description` LONGTEXT NOT NULL,
    `severity` VARCHAR(191) NOT NULL,
    `assignedTo` VARCHAR(191) NULL,
    `assignedToId` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `resolutionNotes` TEXT NULL,
    `slaDueAt` DATETIME(3) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `resolvedBy` VARCHAR(191) NULL,
    `resolvedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Complaint_code_key`(`code`),
    INDEX `Complaint_status_idx`(`status`),
    INDEX `Complaint_severity_idx`(`severity`),
    INDEX `Complaint_patientPrn_idx`(`patientPrn`),
    INDEX `Complaint_raisedAt_idx`(`raisedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `IncidentCapa` ADD CONSTRAINT `IncidentCapa_incidentId_fkey` FOREIGN KEY (`incidentId`) REFERENCES `Incident`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Complaint` ADD CONSTRAINT `Complaint_feedbackSurveyId_fkey` FOREIGN KEY (`feedbackSurveyId`) REFERENCES `FeedbackSurvey`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
