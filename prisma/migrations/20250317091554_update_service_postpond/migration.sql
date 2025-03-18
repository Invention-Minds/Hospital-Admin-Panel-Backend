-- AlterTable
ALTER TABLE `ServiceAppointments` ADD COLUMN `entryDoneBy` VARCHAR(191) NULL,
    ADD COLUMN `postPond` BOOLEAN NULL,
    ADD COLUMN `postPondTime` DATETIME(3) NULL,
    ADD COLUMN `reportDoneBy` VARCHAR(191) NULL;
