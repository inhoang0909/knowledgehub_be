/*
  Warnings:

  - Added the required column `owner_id` to the `datasets` table without a default value. This is not possible if the table is not empty.

*/
-- Step 1: Add owner_id column as nullable first
ALTER TABLE "datasets" ADD COLUMN "owner_id" INTEGER;

-- Step 2: Set owner_id = created_by for all existing datasets
UPDATE "datasets" SET "owner_id" = "created_by" WHERE "owner_id" IS NULL;

-- Step 3: Make owner_id NOT NULL
ALTER TABLE "datasets" ALTER COLUMN "owner_id" SET NOT NULL;

-- Step 4: Add foreign key constraint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
