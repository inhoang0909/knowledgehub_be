-- CreateEnum
CREATE TYPE "MessageFeedback" AS ENUM ('LIKE', 'DISLIKE', 'NONE');

-- CreateEnum
CREATE TYPE "AnnotationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DELETED');

-- CreateTable
CREATE TABLE "chatbots" (
    "id" SERIAL NOT NULL,
    "dify_app_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chatbots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chatbot_datasets" (
    "chatbot_id" INTEGER NOT NULL,
    "dataset_id" INTEGER NOT NULL,

    CONSTRAINT "chatbot_datasets_pkey" PRIMARY KEY ("chatbot_id","dataset_id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" SERIAL NOT NULL,
    "dify_conversation_id" TEXT NOT NULL,
    "chatbot_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" SERIAL NOT NULL,
    "dify_message_id" TEXT NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "query" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "feedback" "MessageFeedback" NOT NULL DEFAULT 'NONE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annotations" (
    "id" SERIAL NOT NULL,
    "message_id" INTEGER NOT NULL,
    "target_dataset_id" INTEGER NOT NULL,
    "expected_answer" TEXT NOT NULL,
    "status" "AnnotationStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "annotations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chatbots_dify_app_id_key" ON "chatbots"("dify_app_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_dify_conversation_id_key" ON "conversations"("dify_conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_dify_message_id_key" ON "messages"("dify_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "annotations_message_id_key" ON "annotations"("message_id");

-- AddForeignKey
ALTER TABLE "chatbot_datasets" ADD CONSTRAINT "chatbot_datasets_chatbot_id_fkey" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chatbot_datasets" ADD CONSTRAINT "chatbot_datasets_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_chatbot_id_fkey" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_target_dataset_id_fkey" FOREIGN KEY ("target_dataset_id") REFERENCES "datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
