-- Phase 9.4a — DiagnosisCodeMaster (ICD-10 + CPT autocomplete catalog).
-- Strictly additive. Seed runs as INSERT IGNORE so re-applying is safe.

CREATE TABLE `DiagnosisCodeMaster` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `category` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    UNIQUE INDEX `DiagnosisCodeMaster_category_code_key`(`category`, `code`),
    INDEX `DiagnosisCodeMaster_category_idx`(`category`),
    INDEX `DiagnosisCodeMaster_code_idx`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Starter seed — common ICD-10 chapters + frequently-used CPT-4 codes.
-- INSERT IGNORE so re-running the migration on a partially-seeded DB
-- is harmless.

INSERT IGNORE INTO `DiagnosisCodeMaster` (`category`, `code`, `description`, `updatedAt`) VALUES
-- ICD-10 — Endocrine / metabolic
('icd', 'E11.9',   'Type 2 diabetes mellitus without complications',                            NOW()),
('icd', 'E10.9',   'Type 1 diabetes mellitus without complications',                            NOW()),
('icd', 'E78.5',   'Hyperlipidaemia, unspecified',                                              NOW()),
('icd', 'E03.9',   'Hypothyroidism, unspecified',                                               NOW()),
-- ICD-10 — Circulatory
('icd', 'I10',     'Essential (primary) hypertension',                                          NOW()),
('icd', 'I21.9',   'Acute myocardial infarction, unspecified',                                  NOW()),
('icd', 'I25.10',  'Atherosclerotic heart disease of native coronary artery without angina',   NOW()),
('icd', 'I50.9',   'Heart failure, unspecified',                                                NOW()),
('icd', 'I63.9',   'Cerebral infarction, unspecified',                                          NOW()),
('icd', 'I48.91',  'Unspecified atrial fibrillation',                                           NOW()),
-- ICD-10 — Respiratory
('icd', 'J18.9',   'Pneumonia, unspecified organism',                                           NOW()),
('icd', 'J44.9',   'Chronic obstructive pulmonary disease, unspecified',                       NOW()),
('icd', 'J45.909', 'Unspecified asthma, uncomplicated',                                         NOW()),
('icd', 'J96.00',  'Acute respiratory failure, unspecified',                                    NOW()),
-- ICD-10 — Digestive / Genitourinary
('icd', 'K35.80',  'Unspecified acute appendicitis',                                            NOW()),
('icd', 'K80.20',  'Calculus of gallbladder without cholecystitis, without obstruction',       NOW()),
('icd', 'K40.90',  'Unilateral inguinal hernia, without obstruction or gangrene',              NOW()),
('icd', 'N17.9',   'Acute kidney failure, unspecified',                                         NOW()),
('icd', 'N20.0',   'Calculus of kidney',                                                        NOW()),
-- ICD-10 — Musculoskeletal / Orthopaedic
('icd', 'M17.11',  'Unilateral primary osteoarthritis, right knee',                            NOW()),
('icd', 'M17.12',  'Unilateral primary osteoarthritis, left knee',                             NOW()),
('icd', 'M16.11',  'Unilateral primary osteoarthritis, right hip',                             NOW()),
('icd', 'M16.12',  'Unilateral primary osteoarthritis, left hip',                              NOW()),
('icd', 'S72.001A','Fracture of unspecified part of neck of right femur, initial encounter',   NOW()),
-- ICD-10 — Symptoms / signs
('icd', 'R10.9',   'Unspecified abdominal pain',                                                NOW()),
('icd', 'R51',     'Headache',                                                                  NOW()),
('icd', 'R52',     'Pain, unspecified',                                                         NOW()),
-- ICD-10 — Obstetrics
('icd', 'O80',     'Encounter for full-term uncomplicated delivery',                            NOW()),
('icd', 'O82',     'Encounter for cesarean delivery without indication',                        NOW()),
('icd', 'Z51.11',  'Encounter for antineoplastic chemotherapy',                                 NOW()),
-- ICD-10 — Mental / Neuro
('icd', 'F32.9',   'Major depressive disorder, single episode, unspecified',                    NOW()),
('icd', 'F41.9',   'Anxiety disorder, unspecified',                                              NOW()),
('icd', 'G40.909', 'Epilepsy, unspecified, not intractable, without status epilepticus',       NOW()),
-- CPT-4 — common procedures
('cpt', '27447',   'Arthroplasty, knee, condyle and plateau; medial AND lateral compartments', NOW()),
('cpt', '27130',   'Total hip arthroplasty',                                                    NOW()),
('cpt', '49560',   'Repair initial incisional or ventral hernia, reducible',                    NOW()),
('cpt', '49505',   'Repair initial inguinal hernia, age 5 years or older; reducible',           NOW()),
('cpt', '47562',   'Laparoscopy, surgical; cholecystectomy',                                    NOW()),
('cpt', '44970',   'Laparoscopy, surgical; appendectomy',                                       NOW()),
('cpt', '59510',   'Routine obstetric care including antepartum, cesarean delivery, postpartum',NOW()),
('cpt', '59400',   'Routine obstetric care including antepartum, vaginal delivery, postpartum', NOW()),
('cpt', '93010',   'Electrocardiogram, routine ECG with at least 12 leads; interpretation',     NOW()),
('cpt', '76700',   'Ultrasound, abdominal, real-time with image documentation; complete',       NOW()),
('cpt', '74176',   'Computed tomography, abdomen and pelvis; without contrast material',        NOW()),
('cpt', '70551',   'Magnetic resonance imaging, brain; without contrast material',              NOW()),
('cpt', '36556',   'Insertion of non-tunneled centrally inserted central venous catheter',      NOW()),
('cpt', '31500',   'Intubation, endotracheal, emergency procedure',                             NOW()),
('cpt', '99291',   'Critical care, evaluation and management of the critically ill patient',    NOW());
