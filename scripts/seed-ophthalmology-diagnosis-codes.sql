-- Ophthalmology starter codes for the Diagnosis Codes master (WHO ICD-10).
--
-- These replace the list that used to be hard-coded in the eye prescription
-- screen, with one correction: it showed "H35.0 Diabetic Retinopathy", but
-- H35.0 is "Background retinopathy and retinal vascular changes". Diabetic
-- retinopathy is H36.0 (with the diabetes code, e.g. E11.3).
--
-- Run AFTER the migration that adds DiagnosisCodeMaster.specialty — easiest is
-- to paste this at the end of that migration.sql before `prisma migrate deploy`.
-- Safe to run more than once. If a code is already in the master, it is only
-- tagged Ophthalmology and re-activated; its description is left as the MRD
-- team wrote it.
--
-- More codes: Masters → Diagnosis codes → ICD-10 → Specialty "Ophthalmology".

INSERT INTO `DiagnosisCodeMaster` (`category`, `code`, `description`, `isActive`, `specialty`, `createdBy`, `updatedAt`)
VALUES
  ('icd', 'H52.1', 'Myopia',                                                       1, 'ophthalmology', 'seed', NOW(3)),
  ('icd', 'H52.2', 'Astigmatism',                                                  1, 'ophthalmology', 'seed', NOW(3)),
  ('icd', 'H25.1', 'Senile nuclear cataract',                                      1, 'ophthalmology', 'seed', NOW(3)),
  ('icd', 'H40.1', 'Primary open-angle glaucoma',                                  1, 'ophthalmology', 'seed', NOW(3)),
  ('icd', 'H35.0', 'Background retinopathy and retinal vascular changes',          1, 'ophthalmology', 'seed', NOW(3)),
  ('icd', 'H36.0', 'Diabetic retinopathy',                                         1, 'ophthalmology', 'seed', NOW(3)),
  ('icd', 'E11.3', 'Type 2 (non-insulin-dependent) diabetes mellitus with ophthalmic complications', 1, 'ophthalmology', 'seed', NOW(3))
ON DUPLICATE KEY UPDATE
  `specialty` = 'ophthalmology',
  `isActive`  = 1,
  `updatedAt` = NOW(3);
