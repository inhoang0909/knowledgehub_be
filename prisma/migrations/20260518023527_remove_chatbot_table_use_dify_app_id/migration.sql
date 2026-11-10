/*
  Warnings:

  - You are about to drop the column `chatbot_id` on the `conversations` table. All the data in the column will be lost.
  - You are about to drop the `chatbot_datasets` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `chatbots` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `dify_app_id` to the `conversations` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "chatbot_datasets" DROP CONSTRAINT "chatbot_datasets_chatbot_id_fkey";

-- DropForeignKey
ALTER TABLE "chatbot_datasets" DROP CONSTRAINT "chatbot_datasets_dataset_id_fkey";

-- DropForeignKey
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_chatbot_id_fkey";

-- AlterTable
ALTER TABLE "conversations" DROP COLUMN "chatbot_id",
ADD COLUMN     "dify_app_id" TEXT NOT NULL;

-- DropTable
DROP TABLE "chatbot_datasets";

-- DropTable
DROP TABLE "chatbots";

-- CreateIndex
CREATE INDEX "conversations_dify_app_id_idx" ON "conversations"("dify_app_id");
