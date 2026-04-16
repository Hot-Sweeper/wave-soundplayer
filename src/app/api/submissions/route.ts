import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { db } from "@/lib/db";
import { saveFile } from "@/lib/storage";
import { validateAudioFile } from "@/lib/audio-validator";
import { getBannedWords, containsBannedWord } from "@/lib/banned-words";
import { broadcastQueueUpdate } from "@/lib/sse";

const MAX_AVATAR_BYTES = (parseInt(process.env.MAX_AVATAR_SIZE_MB ?? "5", 10)) * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const artistName = (formData.get("artistName") as string | null)?.trim();
    const artistNote = (formData.get("artistNote") as string | null)?.trim() ?? "";
    const audioFile  = formData.get("audio") as File | null;
    const avatarFile = formData.get("avatar") as File | null;

    // --- Validate required fields ---
    if (!artistName || artistName.length === 0) {
      return NextResponse.json({ error: "Artist name is required" }, { status: 400 });
    }
    if (artistName.length > 100) {
      return NextResponse.json({ error: "Artist name too long (max 100 chars)" }, { status: 400 });
    }
    if (artistNote.length > 500) {
      return NextResponse.json({ error: "Artist note too long (max 500 chars)" }, { status: 400 });
    }
    if (!audioFile) {
      return NextResponse.json({ error: "Audio file is required" }, { status: 400 });
    }

    // --- Banned words check ---
    const bannedWords = await getBannedWords();
    if (containsBannedWord(artistName, bannedWords) || containsBannedWord(artistNote, bannedWords)) {
      return NextResponse.json({ error: "Submission contains prohibited content" }, { status: 400 });
    }

    // --- Validate audio ---
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    const audioValidation = validateAudioFile(
      audioBuffer,
      audioFile.name,
      audioFile.type,
      audioBuffer.length
    );
    if (!audioValidation.ok) {
      return NextResponse.json({ error: audioValidation.error }, { status: 400 });
    }

    const audioId  = randomUUID();
    const audioExt = audioValidation.ext!;
    const audioPath = await saveFile("audio", `${audioId}.${audioExt}`, audioBuffer);

    // --- Process avatar (optional) ---
    let avatarPath: string | null = null;
    if (avatarFile) {
      if (avatarFile.size > MAX_AVATAR_BYTES) {
        return NextResponse.json({ error: `Avatar too large (max ${process.env.MAX_AVATAR_SIZE_MB ?? 5}MB)` }, { status: 400 });
      }
      const avatarBuffer = Buffer.from(await avatarFile.arrayBuffer());
      const webpBuffer = await sharp(avatarBuffer)
        .resize(200, 200, { fit: "cover" })
        .webp({ quality: 80 })
        .toBuffer();
      avatarPath = await saveFile("avatars", `${audioId}.webp`, webpBuffer);
    }

    // --- Retention setting ---
    const retentionSetting = await db.setting.findUnique({ where: { key: "retention_days" } });
    const retentionDays = retentionSetting ? parseInt(retentionSetting.value, 10) : 30;
    const expiresAt = new Date(Date.now() + retentionDays * 86_400_000);

    // --- Insert submission ---
    const submission = await db.submission.create({
      data: {
        artistName,
        artistNote: artistNote || null,
        audioPath,
        audioExt,
        avatarPath,
        expiresAt,
      },
    });

    // --- Broadcast queue count ---
    const queueCount = await db.submission.count({ where: { playedAt: null } });
    broadcastQueueUpdate(queueCount);

    return NextResponse.json({ id: submission.id, queuePos: submission.queuePos }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
