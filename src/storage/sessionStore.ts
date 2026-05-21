import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { VoiceId } from "../worker/kokoro.worker";

export interface SessionMeta {
  id: string;
  title: string;
  sourceText: string;
  createdAt: number;
  durationSec: number;
  lastPositionSec: number;
  finishedAt: number | null;
  voice: VoiceId;
  modelId: string;
}

const DEFAULT_MODEL = "kokoro-82m-low";

interface CatmDB extends DBSchema {
  sessions: {
    key: string;
    value: SessionMeta;
    indexes: { "by-createdAt": number };
  };
}

const DB_NAME = "catm";
// v3: layout changed from single audio.mp4 to HLS init.mp4 + seg-N.m4s +
// playlist.m3u8. Old sessions are wiped on upgrade — no migration.
const DB_VERSION = 3;

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

async function writeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: Uint8Array | string,
): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: "application/vnd.apple.mpegurl" })
      : new Blob([data as BlobPart]);
  await writable.write(blob);
  await writable.close();
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
    title: deriveTitle(sourceText) || existing.title,
    sourceText,
    durationSec: 0,
    lastPositionSec: 0,
    finishedAt: null,
    voice,
  });
}

export async function writeInit(id: string, bytes: Uint8Array): Promise<void> {
  const dir = await sessionDir(id);
  await writeFile(dir, "init.mp4", bytes);
}

export async function writeSegment(id: string, index: number, bytes: Uint8Array): Promise<void> {
  const dir = await sessionDir(id);
  await writeFile(dir, `seg-${index}.m4s`, bytes);
}

export interface SegmentEntry {
  index: number;
  durationSec: number;
}

export async function writePlaylist(
  id: string,
  segments: SegmentEntry[],
  ended: boolean,
): Promise<void> {
  const dir = await sessionDir(id);
  const targetDuration = Math.max(
    1,
    Math.ceil(segments.reduce((m, s) => Math.max(m, s.durationSec), 1)),
  );
  const lines: string[] = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    "#EXT-X-PLAYLIST-TYPE:EVENT",
    "#EXT-X-MEDIA-SEQUENCE:0",
    '#EXT-X-MAP:URI="init.mp4"',
  ];
  for (const seg of segments) {
    lines.push(`#EXTINF:${seg.durationSec.toFixed(3)},`);
    lines.push(`seg-${seg.index}.m4s`);
  }
  if (ended) lines.push("#EXT-X-ENDLIST");
  lines.push("");
  await writeFile(dir, "playlist.m3u8", lines.join("\n"));
}

export async function finalizeDuration(id: string, durationSec: number): Promise<void> {
  const database = await db();
  const existing = await database.get("sessions", id);
  if (!existing) return;
  await database.put("sessions", { ...existing, durationSec });
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

export async function setPosition(id: string, seconds: number, finished: boolean): Promise<void> {
  const database = await db();
  const existing = await database.get("sessions", id);
  if (!existing) return;
  existing.lastPositionSec = seconds;
  if (finished) existing.finishedAt = Date.now();
  await database.put("sessions", existing);
}
