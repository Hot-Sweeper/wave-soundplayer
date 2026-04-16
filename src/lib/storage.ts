import fs from "fs/promises";
import path from "path";
import { existsSync, mkdirSync } from "fs";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "uploads";

function getUploadRoot(): string {
  // Resolve relative to the project root (process.cwd())
  return path.resolve(process.cwd(), UPLOAD_DIR);
}

export function ensureDir(subdir: string): string {
  const dir = path.join(getUploadRoot(), subdir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export async function saveFile(
  subdir: string,
  filename: string,
  data: Buffer
): Promise<string> {
  const dir = ensureDir(subdir);
  const dest = path.join(dir, filename);
  await fs.writeFile(dest, data);
  // Return relative path from upload root for DB storage
  return path.join(subdir, filename).replace(/\\/g, "/");
}

export async function deleteFile(relativePath: string): Promise<void> {
  const full = path.join(getUploadRoot(), relativePath);
  await fs.unlink(full).catch(() => undefined);
}

export function resolveFilePath(relativePath: string): string {
  return path.join(getUploadRoot(), relativePath);
}
