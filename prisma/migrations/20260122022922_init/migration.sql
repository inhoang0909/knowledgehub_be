/*
  Warnings:

  - You are about to drop the column `content` on the `PendingChunk` table. All the data in the column will be lost.
  - Added the required column `data` to the `PendingChunk` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PendingChunk" DROP COLUMN "content",
ADD COLUMN     "data" JSONB NOT NULL;
