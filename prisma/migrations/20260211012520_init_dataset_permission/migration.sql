/*
  Warnings:

  - The values [DEPT_MANAGER,MEMBER] on the enum `UserRole` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `created_by` on the `documents` table. All the data in the column will be lost.
  - You are about to drop the `dataset_permissions` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `updated_at` to the `segments` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "DatasetRole" AS ENUM ('VIEWER', 'EDITOR', 'MANAGER');

-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('SUPER_ADMIN', 'USER');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER';
COMMIT;

-- DropForeignKey
ALTER TABLE "dataset_permissions" DROP CONSTRAINT "dataset_permissions_dataset_id_fkey";

-- DropForeignKey
ALTER TABLE "dataset_permissions" DROP CONSTRAINT "dataset_permissions_department_id_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_created_by_fkey";

-- AlterTable
ALTER TABLE "documents" DROP COLUMN "created_by";

-- AlterTable
ALTER TABLE "segments" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "updated_by" INTEGER;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER';

-- DropTable
DROP TABLE "dataset_permissions";

-- CreateTable
CREATE TABLE "dataset_members" (
    "id" SERIAL NOT NULL,
    "dataset_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" "DatasetRole" NOT NULL DEFAULT 'VIEWER',

    CONSTRAINT "dataset_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset_department_permissions" (
    "id" SERIAL NOT NULL,
    "dataset_id" INTEGER NOT NULL,
    "department_id" INTEGER NOT NULL,
    "role" "DatasetRole" NOT NULL DEFAULT 'VIEWER',

    CONSTRAINT "dataset_department_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dataset_members_dataset_id_user_id_key" ON "dataset_members"("dataset_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_department_permissions_dataset_id_department_id_key" ON "dataset_department_permissions"("dataset_id", "department_id");

-- AddForeignKey
ALTER TABLE "dataset_members" ADD CONSTRAINT "dataset_members_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_members" ADD CONSTRAINT "dataset_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_department_permissions" ADD CONSTRAINT "dataset_department_permissions_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_department_permissions" ADD CONSTRAINT "dataset_department_permissions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
