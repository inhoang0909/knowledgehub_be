/*
  Warnings:

  - You are about to drop the `Dataset` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PendingChunk` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'DEPT_MANAGER', 'MEMBER');

-- DropForeignKey
ALTER TABLE "PendingChunk" DROP CONSTRAINT "PendingChunk_datasetId_fkey";

-- DropForeignKey
ALTER TABLE "PendingChunk" DROP CONSTRAINT "PendingChunk_userId_fkey";

-- DropTable
DROP TABLE "Dataset";

-- DropTable
DROP TABLE "PendingChunk";

-- DropTable
DROP TABLE "User";

-- CreateTable
CREATE TABLE "departments" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "external_id" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "department_code" TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_datasets" (
    "id" SERIAL NOT NULL,
    "dify_dataset_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schema_config" JSONB NOT NULL,

    CONSTRAINT "app_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_documents" (
    "id" SERIAL NOT NULL,
    "dify_document_id" TEXT NOT NULL,
    "raw_data" JSONB NOT NULL,
    "app_dataset_id" INTEGER NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_external_id_key" ON "users"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_datasets_dify_dataset_id_key" ON "app_datasets"("dify_dataset_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_code_fkey" FOREIGN KEY ("department_code") REFERENCES "departments"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_documents" ADD CONSTRAINT "app_documents_app_dataset_id_fkey" FOREIGN KEY ("app_dataset_id") REFERENCES "app_datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_documents" ADD CONSTRAINT "app_documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
