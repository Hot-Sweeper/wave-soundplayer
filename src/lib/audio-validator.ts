const AUDIO_MAGIC: Record<string, Buffer[]> = {
  mp3:  [Buffer.from([0xff, 0xfb]), Buffer.from([0xff, 0xf3]), Buffer.from([0xff, 0xf2]), Buffer.from("ID3")],
  wav:  [Buffer.from("RIFF")],
  flac: [Buffer.from("fLaC")],
  ogg:  [Buffer.from("OggS")],
  opus: [Buffer.from("OggS")],  // Opus is encapsulated in Ogg
  m4a:  [Buffer.from([0x00, 0x00, 0x00])],  // ftyp box — checked with offset below
};

const ALLOWED_MIME = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/flac",
  "audio/x-flac",
  "audio/ogg",
  "audio/opus",
  "audio/mp4",
  "audio/x-m4a",
  "video/mp4", // Some M4A files report as video/mp4
]);

const ALLOWED_EXTENSIONS = new Set(["mp3", "wav", "flac", "ogg", "opus", "m4a"]);

const MAX_AUDIO_BYTES = (parseInt(process.env.MAX_AUDIO_SIZE_MB ?? "50", 10)) * 1024 * 1024;

export interface AudioValidationResult {
  ok: boolean;
  ext?: string;
  error?: string;
}

export function validateAudioFile(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  sizeBytes: number
): AudioValidationResult {
  if (sizeBytes > MAX_AUDIO_BYTES) {
    return { ok: false, error: `File too large (max ${process.env.MAX_AUDIO_SIZE_MB ?? 50}MB)` };
  }

  // Validate declared MIME type
  if (!ALLOWED_MIME.has(mimeType.toLowerCase())) {
    return { ok: false, error: "Unsupported file type" };
  }

  // Validate extension
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, error: "Unsupported file extension" };
  }

  // Check magic bytes
  if (ext === "mp3") {
    const hasMagic = AUDIO_MAGIC.mp3.some((sig) => buffer.subarray(0, sig.length).equals(sig));
    if (!hasMagic) return { ok: false, error: "Invalid MP3 file" };
  } else if (ext === "wav") {
    if (!buffer.subarray(0, 4).equals(Buffer.from("RIFF"))) return { ok: false, error: "Invalid WAV file" };
  } else if (ext === "flac") {
    if (!buffer.subarray(0, 4).equals(Buffer.from("fLaC"))) return { ok: false, error: "Invalid FLAC file" };
  } else if (ext === "ogg" || ext === "opus") {
    if (!buffer.subarray(0, 4).equals(Buffer.from("OggS"))) return { ok: false, error: "Invalid OGG/Opus file" };
  } else if (ext === "m4a") {
    // ftyp box at offset 4 bytes
    const ftypMarker = buffer.subarray(4, 8).toString("ascii");
    if (ftypMarker !== "ftyp") return { ok: false, error: "Invalid M4A file" };
  }

  return { ok: true, ext };
}
