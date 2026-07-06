-- Phase 9.1c — OT Clearance + Templates + form-field extensions
-- Hand-written. Strictly additive except for the OtIntraOpNote unique-index
-- transition (drop singleton-unique → add composite). No data is lost.

-- ─── OtClearance (new table) ────────────────────────────────────────────
CREATE TABLE `OtClearance` (
    `id` VARCHAR(191) NOT NULL,
    `scheduleId` VARCHAR(191) NOT NULL,
    `paymentMode` VARCHAR(191) NULL,
    `billingNotes` TEXT NULL,
    `clearanceStatus` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `clearedBy` VARCHAR(191) NULL,
    `clearedById` INTEGER NULL,
    `clearedAt` DATETIME(3) NULL,
    `clearedSignatureId` VARCHAR(191) NULL,
    `remarks` TEXT NULL,
    `bypassReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    UNIQUE INDEX `OtClearance_scheduleId_key`(`scheduleId`),
    INDEX `OtClearance_clearanceStatus_idx`(`clearanceStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── SurgicalNotesTemplate (new table) ──────────────────────────────────
CREATE TABLE `SurgicalNotesTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NULL,
    `bodyTemplate` LONGTEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    UNIQUE INDEX `SurgicalNotesTemplate_name_key`(`name`),
    INDEX `SurgicalNotesTemplate_departmentId_idx`(`departmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── OtherNotesTemplate (new table) ─────────────────────────────────────
CREATE TABLE `OtherNotesTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NULL,
    `bodyTemplate` LONGTEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    UNIQUE INDEX `OtherNotesTemplate_name_key`(`name`),
    INDEX `OtherNotesTemplate_departmentId_idx`(`departmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── OtIntraOpNote — unique transition (1:1 → 1:N) ──────────────────────
-- The old @unique on scheduleId is dropped and a composite (scheduleId,
-- noteNumber) added. Existing rows get noteNumber=1 via the new column's
-- default, so the composite key never collides.
ALTER TABLE `OtIntraOpNote` DROP INDEX `OtIntraOpNote_scheduleId_key`;

ALTER TABLE `OtIntraOpNote`
    ADD COLUMN `noteNumber` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `templateId` VARCHAR(191) NULL,
    ADD COLUMN `caseType` VARCHAR(191) NULL,
    ADD COLUMN `assistants` VARCHAR(191) NULL,
    ADD COLUMN `preOpDiagnosis` TEXT NULL,
    ADD COLUMN `postOpDiagnosis` TEXT NULL,
    ADD COLUMN `postOpDiagnosisSame` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `materialToLabHpe` VARCHAR(191) NULL,
    ADD COLUMN `materialToLabCis` VARCHAR(191) NULL,
    ADD COLUMN `materialToLabOthers` TEXT NULL,
    ADD COLUMN `materialToSecurityMlc` TEXT NULL,
    ADD COLUMN `drains` TEXT NULL,
    ADD COLUMN `prosthesisLabel` TEXT NULL,
    ADD COLUMN `significantIntraOpEvent` LONGTEXT NULL,
    ADD COLUMN `position` VARCHAR(191) NULL,
    ADD COLUMN `incision` TEXT NULL,
    ADD COLUMN `procedureSteps` LONGTEXT NULL,
    ADD COLUMN `incisionAt` DATETIME(3) NULL,
    ADD COLUMN `woundClosureAt` DATETIME(3) NULL,
    ADD COLUMN `woundClosureDone` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `skinClosureDone` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `spongeInstrumentCountVerified` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `disposition` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `OtIntraOpNote_scheduleId_noteNumber_key` ON `OtIntraOpNote`(`scheduleId`, `noteNumber`);
CREATE INDEX `OtIntraOpNote_templateId_idx` ON `OtIntraOpNote`(`templateId`);

ALTER TABLE `OtIntraOpNote` ADD CONSTRAINT `OtIntraOpNote_templateId_fkey`
    FOREIGN KEY (`templateId`) REFERENCES `SurgicalNotesTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── OtSafetyChecklist — F-01 field extensions ──────────────────────────
ALTER TABLE `OtSafetyChecklist`
    ADD COLUMN `consentConfirmed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `preopMedicationTaken` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `anaesthEquipSpo2` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `anaesthEquipNibp` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `anaesthEquipEcg` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `anaesthEquipBis` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `hypothermiaRisk` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `warmerInPlace` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `equipmentImplantsAvailable` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `allergyDescription` TEXT NULL,
    ADD COLUMN `bloodLossArrangement` TEXT NULL,
    ADD COLUMN `airwayRiskArrangement` TEXT NULL,
    ADD COLUMN `antibioticName` VARCHAR(191) NULL,
    ADD COLUMN `vteProphylaxisProvided` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `anticipatedDurationMins` INTEGER NULL,
    ADD COLUMN `anticipatedBloodLossMl` INTEGER NULL,
    ADD COLUMN `bloodAvailable` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `glycemicControl` TEXT NULL,
    ADD COLUMN `sterilityConcerns` TEXT NULL,
    ADD COLUMN `anaesthetistConcerns` TEXT NULL,
    ADD COLUMN `correctiveAction` TEXT NULL;

-- ─── Backfill OtClearance for already-running schedules ─────────────────
-- Idempotent: INSERT…SELECT only inserts for schedules that don't already
-- have an OtClearance row. Status='cleared' so the new confirm-gate doesn't
-- trip existing in-flight cases.
INSERT INTO `OtClearance` (`id`, `scheduleId`, `clearanceStatus`, `remarks`, `createdAt`, `updatedAt`)
SELECT
    UUID(),
    s.`id`,
    'cleared',
    'Auto-backfilled @ Phase 9.1c migration',
    NOW(),
    NOW()
FROM `OtSchedule` s
WHERE s.`status` IN ('CONFIRMED', 'IN_PROGRESS', 'CLOSED')
  AND NOT EXISTS (SELECT 1 FROM `OtClearance` c WHERE c.`scheduleId` = s.`id`);
