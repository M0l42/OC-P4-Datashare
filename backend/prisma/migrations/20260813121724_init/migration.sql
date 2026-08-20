-- CreateEnum
CREATE TYPE "file_state" AS ENUM ('pending', 'uploaded', 'scanning', 'ready', 'rejected', 'expired', 'abandoned');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(127) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" VARCHAR(512),
    "download_token" VARCHAR(64) NOT NULL,
    "password_hash" VARCHAR(255),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "state" "file_state" NOT NULL,
    "upload_id" VARCHAR(255),
    "part_size" INTEGER NOT NULL DEFAULT 8388608,
    "show_sender" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "owner_id" UUID NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "files_download_token_key" ON "files"("download_token");

-- CreateIndex
CREATE INDEX "files_state_expires_at_idx" ON "files"("state", "expires_at");

-- CreateIndex
CREATE INDEX "files_state_created_at_idx" ON "files"("state", "created_at");

-- CreateIndex
CREATE INDEX "files_owner_id_idx" ON "files"("owner_id");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
