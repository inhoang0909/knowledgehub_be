-- AlterTable
ALTER TABLE "datasets" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "is_deleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "documents" ALTER COLUMN "dify_document_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "dataset_permissions" (
    "id" SERIAL NOT NULL,
    "dataset_id" INTEGER NOT NULL,
    "department_id" INTEGER NOT NULL,
    "can_read" BOOLEAN NOT NULL DEFAULT true,
    "can_write" BOOLEAN NOT NULL DEFAULT false,
    "can_manage" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "dataset_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dataset_permissions_dataset_id_department_id_key" ON "dataset_permissions"("dataset_id", "department_id");

-- AddForeignKey
ALTER TABLE "dataset_permissions" ADD CONSTRAINT "dataset_permissions_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_permissions" ADD CONSTRAINT "dataset_permissions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
