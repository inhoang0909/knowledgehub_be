-- CreateTable
CREATE TABLE "segments" (
    "id" SERIAL NOT NULL,
    "document_id" INTEGER NOT NULL,
    "dify_segment_id" TEXT NOT NULL,
    "raw_data" JSONB NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
