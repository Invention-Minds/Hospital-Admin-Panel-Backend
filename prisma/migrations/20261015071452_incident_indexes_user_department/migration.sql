-- AlterTable
ALTER TABLE `users` ADD COLUMN `department` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Complaint_admissionId_idx` ON `Complaint`(`admissionId`);

-- CreateIndex
CREATE INDEX `Complaint_appointmentId_idx` ON `Complaint`(`appointmentId`);

-- CreateIndex
CREATE INDEX `Complaint_emergencyId_idx` ON `Complaint`(`emergencyId`);

-- CreateIndex
CREATE INDEX `Incident_ruleKey_status_idx` ON `Incident`(`ruleKey`, `status`);

-- CreateIndex
CREATE INDEX `Incident_admissionId_idx` ON `Incident`(`admissionId`);

-- CreateIndex
CREATE INDEX `Incident_emergencyId_idx` ON `Incident`(`emergencyId`);

-- CreateIndex
CREATE INDEX `Incident_appointmentId_idx` ON `Incident`(`appointmentId`);

-- CreateIndex
CREATE INDEX `Incident_assignedToId_idx` ON `Incident`(`assignedToId`);

-- CreateIndex
CREATE INDEX `Incident_reportedById_idx` ON `Incident`(`reportedById`);
