-- CreateIndex
CREATE INDEX `BookedSlot_doctorId_date_idx` ON `BookedSlot`(`doctorId`, `date`);

-- CreateIndex
CREATE INDEX `appointments_date_status_idx` ON `appointments`(`date`, `status`);

-- CreateIndex
CREATE INDEX `appointments_doctorId_date_idx` ON `appointments`(`doctorId`, `date`);
