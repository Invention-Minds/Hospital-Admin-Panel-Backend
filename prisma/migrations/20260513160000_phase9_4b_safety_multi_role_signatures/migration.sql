-- Phase 9.4b — WHO Safe Surgery Checklist multi-role 4-signer chain.
-- 9 new nullable columns per phase × 3 phases = 27 additive columns.
-- Existing single signer columns stay; they now represent the SURGEON role.

ALTER TABLE `OtSafetyChecklist`
    ADD COLUMN `signInAnaesthetistAt` DATETIME(3) NULL,
    ADD COLUMN `signInAnaesthetistBy` VARCHAR(191) NULL,
    ADD COLUMN `signInAnaesthetistSignatureId` VARCHAR(191) NULL,
    ADD COLUMN `signInNurseAt` DATETIME(3) NULL,
    ADD COLUMN `signInNurseBy` VARCHAR(191) NULL,
    ADD COLUMN `signInNurseSignatureId` VARCHAR(191) NULL,
    ADD COLUMN `signInTechnicianAt` DATETIME(3) NULL,
    ADD COLUMN `signInTechnicianBy` VARCHAR(191) NULL,
    ADD COLUMN `signInTechnicianSignatureId` VARCHAR(191) NULL,
    ADD COLUMN `timeOutAnaesthetistAt` DATETIME(3) NULL,
    ADD COLUMN `timeOutAnaesthetistBy` VARCHAR(191) NULL,
    ADD COLUMN `timeOutAnaesthetistSignatureId` VARCHAR(191) NULL,
    ADD COLUMN `timeOutNurseAt` DATETIME(3) NULL,
    ADD COLUMN `timeOutNurseBy` VARCHAR(191) NULL,
    ADD COLUMN `timeOutNurseSignatureId` VARCHAR(191) NULL,
    ADD COLUMN `timeOutTechnicianAt` DATETIME(3) NULL,
    ADD COLUMN `timeOutTechnicianBy` VARCHAR(191) NULL,
    ADD COLUMN `timeOutTechnicianSignatureId` VARCHAR(191) NULL,
    ADD COLUMN `signOutAnaesthetistAt` DATETIME(3) NULL,
    ADD COLUMN `signOutAnaesthetistBy` VARCHAR(191) NULL,
    ADD COLUMN `signOutAnaesthetistSignatureId` VARCHAR(191) NULL,
    ADD COLUMN `signOutNurseAt` DATETIME(3) NULL,
    ADD COLUMN `signOutNurseBy` VARCHAR(191) NULL,
    ADD COLUMN `signOutNurseSignatureId` VARCHAR(191) NULL,
    ADD COLUMN `signOutTechnicianAt` DATETIME(3) NULL,
    ADD COLUMN `signOutTechnicianBy` VARCHAR(191) NULL,
    ADD COLUMN `signOutTechnicianSignatureId` VARCHAR(191) NULL;
