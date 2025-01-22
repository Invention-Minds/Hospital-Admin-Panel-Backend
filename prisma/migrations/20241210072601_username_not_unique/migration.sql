/*
  Warnings:

  - A unique constraint covering the columns `[employeeId]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX `users_username_key` ON `users`;

-- CreateIndex
CREATE UNIQUE INDEX `users_employeeId_key` ON `users`(`employeeId`);
