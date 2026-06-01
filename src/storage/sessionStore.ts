import { strToU8, zipSync } from "fflate";
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { VoiceId } from "../worker/kokoro.worker";
import type { SessionMeta, StorageBreakdown } from "./sessionTypes";

export type { SessionMeta, StorageBreakdown };

const DEFAULT_MODEL = "kokoro-82m-low";

interface CatmDB extends DBSchema {
  sessions: {
    key: string;
    value: SessionMeta;
    indexes: { "by-createdAt": number };
  };
}

const DB_NAME = "catm";
// v6: past short-lived dev versions 4/5 so browsers that opened those still upgrade.
const DB_VERSION = 6;

let dbPromise: Promise<IDBPDatabase<CatmDB>> | null = null;

function db(): Promise<IDBPDatabase<CatmDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CatmDB>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (database.objectStoreNames.contains("sessions")) {
          database.deleteObjectStore("sessions");
        }
        const store = database.createObjectStore("sessions", { keyPath: "id" });
        store.createIndex("by-createdAt", "createdAt");
        if (oldVersion > 0) {
          // Best-effort wipe of OPFS contents from the previous layout.
          void wipeOpfsSessions();
        }
      },
    });
  }
  return dbPromise;
}

async function wipeOpfsSessions(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry("sessions", { recursive: true });
  } catch {
    /* directory may not exist */
  }
}

async function sessionsRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("sessions", { create: true });
}

async function sessionDir(id: string): Promise<FileSystemDirectoryHandle> {
  const root = await sessionsRoot();
  return root.getDirectoryHandle(id, { create: true });
}

function deriveTitle(sourceText: string): string {
  const collapsed = sourceText.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 60) return collapsed;
  return `${collapsed.slice(0, 57)}…`;
}

export interface CreateSessionInput {
  sourceText: string;
  voice: VoiceId;
}

export async function createSession(input: CreateSessionInput): Promise<SessionMeta> {
  const id = crypto.randomUUID();
  // Pre-create the directory; init/segments/playlist will be written by
  // writeInit / writeSegment / finalizePlaylist as encoding proceeds.
  await sessionDir(id);
  const meta: SessionMeta = {
    id,
    title: deriveTitle(input.sourceText) || "Untitled",
    sourceText: input.sourceText,
    createdAt: Date.now(),
    durationSec: 0,
    lastPositionSec: 0,
    finishedAt: null,
    voice: input.voice,
    modelId: DEFAULT_MODEL,
  };
  const database = await db();
  await database.put("sessions", meta);
  return meta;
}

export async function resetSession(id: string, sourceText: string, voice: VoiceId): Promise<void> {
  // Wipe any prior segment files for this session so re-synthesis starts clean.
  const root = await sessionsRoot();
  try {
    await root.removeEntry(id, { recursive: true });
  } catch {
    /* fresh session has no entry */
  }
  await sessionDir(id);
  const database = await db();
  const existing = await database.get("sessions", id);
  if (!existing) return;
  await database.put("sessions", {
    ...existing,
    title: existing.titleEdited ? existing.title : deriveTitle(sourceText) || existing.title,
    sourceText,
    durationSec: 0,
    lastPositionSec: 0,
    finishedAt: null,
    voice,
  });
}

export async function renameSession(id: string, rawTitle: string): Promise<void> {
  const database = await db();
  const existing = await database.get("sessions", id);
  if (!existing) return;
  const trimmed = rawTitle.trim();
  if (trimmed.length === 0) {
    // Clearing the title reverts to auto-derivation from the current text.
    const { titleEdited: _drop, ...rest } = existing;
    await database.put("sessions", {
      ...rest,
      title: deriveTitle(existing.sourceText) || "Untitled",
    });
    return;
  }
  await database.put("sessions", {
    ...existing,
    title: trimmed.slice(0, 120),
    titleEdited: true,
  });
}

export async function finalizeDuration(id: string, durationSec: number): Promise<void> {
  const database = await db();
  const existing = await database.get("sessions", id);
  if (!existing) return;
  await database.put("sessions", { ...existing, durationSec });
}

export async function finalizeChunks(
  id: string,
  chunkDurations: number[],
  chunkTexts: string[],
): Promise<void> {
  const database = await db();
  const existing = await database.get("sessions", id);
  if (!existing) return;
  await database.put("sessions", { ...existing, chunkDurations, chunkTexts });
}

export async function readSessionFile(id: string, name: string): Promise<Uint8Array | null> {
  try {
    const dir = await sessionDir(id);
    const file = await dir.getFileHandle(name);
    const blob = await file.getFile();
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<SessionMeta[]> {
  const database = await db();
  const rows = await database.getAllFromIndex("sessions", "by-createdAt");
  return rows.reverse();
}

export async function deleteSession(id: string): Promise<void> {
  const root = await sessionsRoot();
  try {
    await root.removeEntry(id, { recursive: true });
  } catch {
    // OPFS entry may already be gone; metadata removal is the source of truth.
  }
  const database = await db();
  await database.delete("sessions", id);
}

function formatStampForFilename(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function readPlaylistSegmentNames(id: string): Promise<string[]> {
  const bytes = await readSessionFile(id, "playlist.m3u8");
  if (!bytes) return [];
  const text = new TextDecoder().decode(bytes);
  const names: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line && !line.startsWith("#")) names.push(line);
  }
  return names;
}

export interface ExportBundle {
  bytes: Uint8Array;
  filename: string;
}

/**
 * Build a .zip containing a single top-level folder (`catm-<stamp>/`) with:
 *   - audio.mp4           init segment + media segments concatenated into one
 *                         fragmented MP4 (valid byte concat — no remux)
 *   - source.txt          source text
 *   - meta.json           voice, model, createdAt, durationSec
 *
 * Returns null if the session has no init segment yet (still synthesising or
 * otherwise incomplete) or if any referenced segment is missing.
 */
export async function buildSessionExport(meta: SessionMeta): Promise<ExportBundle | null> {
  const init = await readSessionFile(meta.id, "init.mp4");
  if (!init) return null;
  const segNames = await readPlaylistSegmentNames(meta.id);

  const parts: Uint8Array[] = [init];
  let total = init.byteLength;
  for (const name of segNames) {
    const bytes = await readSessionFile(meta.id, name);
    if (!bytes) return null;
    parts.push(bytes);
    total += bytes.byteLength;
  }
  const audio = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    audio.set(part, offset);
    offset += part.byteLength;
  }

  const stamp = formatStampForFilename(meta.createdAt);
  const folder = `catm-${stamp}`;
  const manifest = {
    title: meta.title,
    voice: meta.voice,
    model: meta.modelId,
    createdAt: new Date(meta.createdAt).toISOString(),
    durationSec: meta.durationSec,
    exportedAt: new Date().toISOString(),
  };

  const entries: Record<string, Uint8Array> = {
    [`${folder}/audio.mp4`]: audio,
    [`${folder}/source.txt`]: strToU8(meta.sourceText),
    [`${folder}/meta.json`]: strToU8(JSON.stringify(manifest, null, 2)),
  };

  // Store-only: the MP4 payload is already AAC-compressed; deflate saves nothing.
  const zipped = zipSync(entries, { level: 0 });
  return { bytes: zipped, filename: `${folder}.zip` };
}

export async function measureStorage(): Promise<StorageBreakdown> {
  const est = await navigator.storage?.estimate?.();
  const usage = est?.usage ?? 0;
  const quotaBytes = est?.quota ?? 0;
  let sessionsBytes = 0;
  try {
    const root = await navigator.storage.getDirectory();
    const sessions = await root.getDirectoryHandle("sessions");
    const sessionsAsIter = sessions as unknown as {
      values(): AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
    };
    for await (const dir of sessionsAsIter.values()) {
      if (dir.kind !== "directory") continue;
      const dirAsIter = dir as unknown as {
        values(): AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
      };
      for await (const entry of dirAsIter.values()) {
        if (entry.kind !== "file") continue;
        const file = await (entry as FileSystemFileHandle).getFile();
        sessionsBytes += file.size;
      }
    }
  } catch {
    /* no sessions dir yet, or OPFS unavailable */
  }
  const voiceBytes = Math.max(0, usage - sessionsBytes);
  const headroomBytes = Math.max(0, quotaBytes - usage);
  const persisted = (await navigator.storage?.persisted?.()) ?? false;
  return { sessionsBytes, voiceBytes, quotaBytes, headroomBytes, persisted };
}

export async function setPosition(id: string, seconds: number, finished: boolean): Promise<void> {
  const database = await db();
  const existing = await database.get("sessions", id);
  if (!existing) return;
  existing.lastPositionSec = seconds;
  if (finished) existing.finishedAt = Date.now();
  await database.put("sessions", existing);
}
