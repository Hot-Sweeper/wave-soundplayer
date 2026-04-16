import { db } from "./db";

export async function getBannedWords(): Promise<string[]> {
  const setting = await db.setting.findUnique({ where: { key: "banned_words" } });
  if (!setting) return [];
  return JSON.parse(setting.value) as string[];
}

export function containsBannedWord(text: string, bannedWords: string[]): boolean {
  if (bannedWords.length === 0) return false;
  const normalized = text.normalize("NFC").toLowerCase();
  return bannedWords.some((word) => normalized.includes(word.normalize("NFC").toLowerCase()));
}
