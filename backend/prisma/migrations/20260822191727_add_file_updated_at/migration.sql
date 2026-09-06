-- AlterTable
ALTER TABLE "files" ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "files_state_updated_at_idx" ON "files"("state", "updated_at");
