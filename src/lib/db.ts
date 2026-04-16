import { randomUUID } from "crypto";
import { Pool } from "pg";

export type ReactionType = "LIKE" | "DISLIKE" | "FIRE";

type SettingRecord = {
  key: string;
  value: string;
  updatedAt: Date;
};

type SubmissionRecord = {
  id: string;
  artistName: string;
  artistNote: string | null;
  audioPath: string;
  audioExt: string;
  avatarPath: string | null;
  queuePos: number;
  playedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
};

type ReactionRecord = {
  id: string;
  submissionId: string;
  type: ReactionType;
  createdAt: Date;
};

type SelectShape = Record<string, boolean>;

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  return new Pool({ connectionString });
}

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function getPool(): Pool {
  if (!globalThis.__pgPool) {
    globalThis.__pgPool = createPool();
  }
  return globalThis.__pgPool;
}

async function query<T extends import("pg").QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await getPool().query<T>(text, values);
  return result.rows;
}

function applySelect<T extends Record<string, unknown>>(record: T, select?: SelectShape) {
  if (!select) return record;

  const entries = Object.entries(select)
    .filter(([, enabled]) => enabled)
    .map(([key]) => [key, record[key]]);

  return Object.fromEntries(entries);
}

function mapSetting(row: { key: string; value: string; updated_at: Date }): SettingRecord {
  return {
    key: row.key,
    value: row.value,
    updatedAt: row.updated_at,
  };
}

function mapSubmission(row: {
  id: string;
  artist_name: string;
  artist_note: string | null;
  audio_path: string;
  audio_ext: string;
  avatar_path: string | null;
  queue_pos: number;
  played_at: Date | null;
  expires_at: Date;
  created_at: Date;
}): SubmissionRecord {
  return {
    id: row.id,
    artistName: row.artist_name,
    artistNote: row.artist_note,
    audioPath: row.audio_path,
    audioExt: row.audio_ext,
    avatarPath: row.avatar_path,
    queuePos: row.queue_pos,
    playedAt: row.played_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function mapReaction(row: {
  id: string;
  submission_id: string;
  type: ReactionType;
  created_at: Date;
}): ReactionRecord {
  return {
    id: row.id,
    submissionId: row.submission_id,
    type: row.type,
    createdAt: row.created_at,
  };
}

export const db = {
  setting: {
    async findUnique({ where }: { where: { key: string } }) {
      const rows = await query<{ key: string; value: string; updated_at: Date }>(
        `SELECT key, value, updated_at FROM settings WHERE key = $1 LIMIT 1`,
        [where.key],
      );

      return rows[0] ? mapSetting(rows[0]) : null;
    },

    async findMany() {
      const rows = await query<{ key: string; value: string; updated_at: Date }>(
        `SELECT key, value, updated_at FROM settings ORDER BY key ASC`,
      );

      return rows.map(mapSetting);
    },

    async upsert({
      where,
      update,
      create,
    }: {
      where: { key: string };
      update: { value: string };
      create: { key: string; value: string };
    }) {
      const rows = await query<{ key: string; value: string; updated_at: Date }>(
        `
          INSERT INTO settings (key, value, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (key)
          DO UPDATE SET value = $3, updated_at = NOW()
          RETURNING key, value, updated_at
        `,
        [create.key ?? where.key, create.value, update.value],
      );

      return mapSetting(rows[0]);
    },
  },

  submission: {
    async create({
      data,
    }: {
      data: {
        artistName: string;
        artistNote: string | null;
        audioPath: string;
        audioExt: string;
        avatarPath: string | null;
        expiresAt: Date;
      };
    }) {
      const id = randomUUID();
      const rows = await query<{
        id: string;
        artist_name: string;
        artist_note: string | null;
        audio_path: string;
        audio_ext: string;
        avatar_path: string | null;
        queue_pos: number;
        played_at: Date | null;
        expires_at: Date;
        created_at: Date;
      }>(
        `
          INSERT INTO submissions (
            id,
            artist_name,
            artist_note,
            audio_path,
            audio_ext,
            avatar_path,
            expires_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, artist_name, artist_note, audio_path, audio_ext, avatar_path, queue_pos, played_at, expires_at, created_at
        `,
        [
          id,
          data.artistName,
          data.artistNote,
          data.audioPath,
          data.audioExt,
          data.avatarPath,
          data.expiresAt,
        ],
      );

      return mapSubmission(rows[0]);
    },

    async findMany({
      where,
      orderBy,
      select,
    }: {
      where?: { playedAt?: null };
      orderBy?: { queuePos: "asc" | "desc" };
      select?: SelectShape;
    }) {
      const clauses: string[] = [];
      if (where?.playedAt === null) {
        clauses.push(`played_at IS NULL`);
      }

      const orderDirection = orderBy?.queuePos === "desc" ? "DESC" : "ASC";
      const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = await query<{
        id: string;
        artist_name: string;
        artist_note: string | null;
        audio_path: string;
        audio_ext: string;
        avatar_path: string | null;
        queue_pos: number;
        played_at: Date | null;
        expires_at: Date;
        created_at: Date;
      }>(
        `
          SELECT id, artist_name, artist_note, audio_path, audio_ext, avatar_path, queue_pos, played_at, expires_at, created_at
          FROM submissions
          ${whereSql}
          ORDER BY queue_pos ${orderDirection}
        `,
      );

      return rows.map((row) => applySelect(mapSubmission(row), select));
    },

    async findUnique({
      where,
      select,
    }: {
      where: { id: string };
      select?: SelectShape;
    }) {
      const rows = await query<{
        id: string;
        artist_name: string;
        artist_note: string | null;
        audio_path: string;
        audio_ext: string;
        avatar_path: string | null;
        queue_pos: number;
        played_at: Date | null;
        expires_at: Date;
        created_at: Date;
      }>(
        `
          SELECT id, artist_name, artist_note, audio_path, audio_ext, avatar_path, queue_pos, played_at, expires_at, created_at
          FROM submissions
          WHERE id = $1
          LIMIT 1
        `,
        [where.id],
      );

      if (!rows[0]) return null;
      return applySelect(mapSubmission(rows[0]), select);
    },

    async count({ where }: { where?: { playedAt?: null } }) {
      const clauses: string[] = [];
      if (where?.playedAt === null) {
        clauses.push(`played_at IS NULL`);
      }

      const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM submissions ${whereSql}`,
      );

      return Number(rows[0]?.count ?? 0);
    },

    async delete({ where }: { where: { id: string } }) {
      const rows = await query<{
        id: string;
        artist_name: string;
        artist_note: string | null;
        audio_path: string;
        audio_ext: string;
        avatar_path: string | null;
        queue_pos: number;
        played_at: Date | null;
        expires_at: Date;
        created_at: Date;
      }>(
        `
          DELETE FROM submissions
          WHERE id = $1
          RETURNING id, artist_name, artist_note, audio_path, audio_ext, avatar_path, queue_pos, played_at, expires_at, created_at
        `,
        [where.id],
      );

      return rows[0] ? mapSubmission(rows[0]) : null;
    },

    async update({
      where,
      data,
    }: {
      where: { id: string };
      data: { playedAt?: Date | null };
    }) {
      const rows = await query<{
        id: string;
        artist_name: string;
        artist_note: string | null;
        audio_path: string;
        audio_ext: string;
        avatar_path: string | null;
        queue_pos: number;
        played_at: Date | null;
        expires_at: Date;
        created_at: Date;
      }>(
        `
          UPDATE submissions
          SET played_at = $2
          WHERE id = $1
          RETURNING id, artist_name, artist_note, audio_path, audio_ext, avatar_path, queue_pos, played_at, expires_at, created_at
        `,
        [where.id, data.playedAt ?? null],
      );

      return rows[0] ? mapSubmission(rows[0]) : null;
    },

    async restorePlayed() {
      const rows = await query<{ count: string }>(
        `
          WITH restored AS (
            UPDATE submissions
            SET played_at = NULL
            WHERE played_at IS NOT NULL
            RETURNING id
          )
          SELECT COUNT(*)::text AS count FROM restored
        `,
      );

      return Number(rows[0]?.count ?? 0);
    },
  },

  reaction: {
    async create({
      data,
    }: {
      data: { submissionId: string; type: ReactionType };
    }) {
      const id = randomUUID();
      const rows = await query<{
        id: string;
        submission_id: string;
        type: ReactionType;
        created_at: Date;
      }>(
        `
          INSERT INTO reactions (id, submission_id, type)
          VALUES ($1, $2, $3)
          RETURNING id, submission_id, type, created_at
        `,
        [id, data.submissionId, data.type],
      );

      return mapReaction(rows[0]);
    },
  },

  history: {
    async findMany(filter?: ReactionType) {
      const hasFilter = Boolean(filter);
      const params = hasFilter ? [filter] : [];

      const rows = await query<{
        id: string;
        artist_name: string;
        artist_note: string | null;
        audio_ext: string;
        avatar_path: string | null;
        played_at: Date | null;
        created_at: Date;
        like_count: string;
        dislike_count: string;
        fire_count: string;
      }>(
        `
          SELECT
            s.id,
            s.artist_name,
            s.artist_note,
            s.audio_ext,
            s.avatar_path,
            s.played_at,
            s.created_at,
            COUNT(*) FILTER (WHERE r.type = 'LIKE')::text AS like_count,
            COUNT(*) FILTER (WHERE r.type = 'DISLIKE')::text AS dislike_count,
            COUNT(*) FILTER (WHERE r.type = 'FIRE')::text AS fire_count
          FROM submissions s
          LEFT JOIN reactions r ON r.submission_id = s.id
          GROUP BY s.id, s.artist_name, s.artist_note, s.audio_ext, s.avatar_path, s.played_at, s.created_at
          HAVING ${hasFilter
            ? "COUNT(*) FILTER (WHERE r.type = $1) > 0"
            : "s.played_at IS NOT NULL OR COUNT(r.id) > 0"}
          ORDER BY COALESCE(s.played_at, s.created_at) DESC, s.created_at DESC
        `,
        params,
      );

      return rows.map((row) => ({
        id: row.id,
        artistName: row.artist_name,
        artistNote: row.artist_note,
        audioExt: row.audio_ext,
        avatarPath: row.avatar_path,
        playedAt: row.played_at ? row.played_at.toISOString() : null,
        createdAt: row.created_at.toISOString(),
        reactions: {
          LIKE: Number(row.like_count),
          DISLIKE: Number(row.dislike_count),
          FIRE: Number(row.fire_count),
        },
      }));
    },
  },
};
