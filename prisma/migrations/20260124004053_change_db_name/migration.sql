/*
  Warnings:

  - You are about to drop the `app_datasets` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `app_documents` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "app_documents" DROP CONSTRAINT "app_documents_app_dataset_id_fkey";

-- DropForeignKey
ALTER TABLE "app_documents" DROP CONSTRAINT "app_documents_created_by_fkey";

-- DropTable
DROP TABLE "app_datasets";

-- DropTable
DROP TABLE "app_documents";

-- CreateTable
CREATE TABLE "datasets" (
    "id" SERIAL NOT NULL,
    "dify_dataset_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schema_config" JSONB NOT NULL,

    CONSTRAINT "datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" SERIAL NOT NULL,
    "dify_document_id" TEXT NOT NULL,
    "raw_data" JSONB NOT NULL,
    "dataset_id" INTEGER NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "datasets_dify_dataset_id_key" ON "datasets"("dify_dataset_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
