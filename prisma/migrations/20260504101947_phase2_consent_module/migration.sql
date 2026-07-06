-- CreateTable
CREATE TABLE `ConsentForm` (
    `id` VARCHAR(191) NOT NULL,
    `consentType` VARCHAR(191) NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `language` VARCHAR(191) NOT NULL DEFAULT 'en',
    `title` VARCHAR(191) NOT NULL,
    `bodyText` LONGTEXT NOT NULL,
    `pdfTemplateUrl` VARCHAR(191) NULL,
    `requiresWitness` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `effectiveFrom` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `effectiveTo` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,

    INDEX `ConsentForm_consentType_language_isActive_idx`(`consentType`, `language`, `isActive`),
    UNIQUE INDEX `ConsentForm_consentType_version_language_key`(`consentType`, `version`, `language`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsentSignature` (
    `id` VARCHAR(191) NOT NULL,
    `formId` VARCHAR(191) NOT NULL,
    `consentType` VARCHAR(191) NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `language` VARCHAR(191) NOT NULL,
    `contextType` VARCHAR(191) NULL,
    `contextId` VARCHAR(191) NULL,
    `patientPrn` INTEGER NULL,
    `patientName` VARCHAR(191) NULL,
    `patientSignatureId` VARCHAR(191) NULL,
    `patientSignedAt` DATETIME(3) NULL,
    `attenderSignatureId` VARCHAR(191) NULL,
    `attenderName` VARCHAR(191) NULL,
    `attenderRelation` VARCHAR(191) NULL,
    `attenderSignedAt` DATETIME(3) NULL,
    `witnessSignatureId` VARCHAR(191) NULL,
    `witnessName` VARCHAR(191) NULL,
    `witnessSignedAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'SIGNED',
    `deferredReason` VARCHAR(191) NULL,
    `refusedReason` VARCHAR(191) NULL,
    `signedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,

    INDEX `ConsentSignature_consentType_contextType_contextId_idx`(`consentType`, `contextType`, `contextId`),
    INDEX `ConsentSignature_patientPrn_idx`(`patientPrn`),
    INDEX `ConsentSignature_signedAt_idx`(`signedAt`),
    INDEX `ConsentSignature_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ConsentSignature` ADD CONSTRAINT `ConsentSignature_formId_fkey` FOREIGN KEY (`formId`) REFERENCES `ConsentForm`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
