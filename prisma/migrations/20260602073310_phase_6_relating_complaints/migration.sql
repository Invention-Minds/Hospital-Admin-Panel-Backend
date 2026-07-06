/*
  Warnings:

  - A unique constraint covering the columns `[complaintId]` on the table `Incident` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `Complaint` ADD COLUMN `admissionId` VARCHAR(191) NULL,
    ADD COLUMN `appointmentId` INTEGER NULL,
    ADD COLUMN `emergencyId` INTEGER NULL,
    ADD COLUMN `relatedIncidentIds` TEXT NULL;

-- AlterTable
ALTER TABLE `Incident` ADD COLUMN `complaintId` VARCHAR(191) NULL,
    ADD COLUMN `feedbackSurveyId` VARCHAR(191) NULL,
    ADD COLUMN `relatedIncidentIds` TEXT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Incident_complaintId_key` ON `Incident`(`complaintId`);
