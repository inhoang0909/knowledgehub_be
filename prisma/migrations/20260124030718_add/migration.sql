-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_dataset_id_fkey";

-- AlterTable
ALTER TABLE "documents" ALTER COLUMN "raw_data" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
