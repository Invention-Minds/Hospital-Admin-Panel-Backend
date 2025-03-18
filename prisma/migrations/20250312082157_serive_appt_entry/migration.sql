-- AlterTable
ALTER TABLE `ServiceAppointments` ADD COLUMN `entry` BOOLEAN NULL,
    ADD COLUMN `entryTime` DATETIME(3) NULL;
