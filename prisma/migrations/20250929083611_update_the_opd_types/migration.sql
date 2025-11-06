/*
  Warnings:

  - You are about to alter the column `npo` on the `OPDAssessment` table. The data in that column could be lost. The data in that column will be cast from `Text` to `TinyInt`.
  - You are about to alter the column `screeningReq` on the `OPDAssessment` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `TinyInt`.
  - You are about to alter the column `implantCounsel` on the `OPDAssessment` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `TinyInt`.

*/
-- AlterTable
ALTER TABLE `OPDAssessment` ADD COLUMN `doctorName` VARCHAR(191) NULL,
    ADD COLUMN `kmcNo` VARCHAR(191) NULL,
    MODIFY `npo` BOOLEAN NULL,
    MODIFY `screeningReq` BOOLEAN NULL,
    MODIFY `implantCounsel` BOOLEAN NULL;
