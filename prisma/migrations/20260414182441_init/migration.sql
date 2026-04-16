-- CreateEnum
CREATE TYPE "ReactionType" AS ENUM ('LIKE', 'DISLIKE', 'FIRE');

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "artist_name" VARCHAR(100) NOT NULL,
    "artist_note" VARCHAR(500),
    "audio_path" TEXT NOT NULL,
    "audio_ext" VARCHAR(10) NOT NULL,
    "avatar_path" TEXT,
    "queue_pos" SERIAL NOT NULL,
    "played_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reactions" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "type" "ReactionType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "submissions_played_at_idx" ON "submissions"("played_at");

-- CreateIndex
CREATE INDEX "submissions_expires_at_idx" ON "submissions"("expires_at");

-- CreateIndex
CREATE INDEX "reactions_submission_id_idx" ON "reactions"("submission_id");

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
