import { type DBSchema, type IDBPDatabase, openDB } from "idb";

export interface SessionMeta {
  id: string;
  title: string;
  sourceText: string;
  createdAt: number;
  durationSec: number;
  lastPositionSec: number;
  finishedAt: number | null;
}

interface CatmDB extends DBSchema {
  sessions: {
    key: string;
    value: SessionMeta;
    indexes: { "by-createdAt": number };
  };
}

const DB_NAME = "catm";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<CatmDB>> | null = null;

function db(): Promise<IDBPDatabase<CatmDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CatmDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const store = database.createObjectStore("sessions", { keyPath: "id" });
        store.createIndex("by-createdAt", "createdAt");
      },
    });
  }
  return dbPromise;
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

export interface CreateInput {
  sourceText: string;
  audio: Blob;
  durationSec: number;
}

export async function createSession(input: CreateInput): Promise<SessionMeta> {
  const id = crypto.randomUUID();
  const dir = await sessionDir(id);
  const file = await dir.getFileHandle("audio.wav", { create: true });
  const writable = await file.createWritable();
  await writable.write(input.audio);
  await writable.close();

  const meta: SessionMeta = {
    id,
    title: deriveTitle(input.sourceText) || "Untitled",
    sourceText: input.sourceText,
    createdAt: Date.now(),
    durationSec: input.durationSec,
    lastPositionSec: 0,
    finishedAt: null,
  };
  const database = await db();
  await database.put("sessions", meta);
  return meta;
}

export async function listSessions(): Promise<SessionMeta[]> {
  const database = await db();
  const rows = await database.getAllFromIndex("sessions", "by-createdAt");
  return rows.reverse();
}

export async function getAudioBlob(id: string): Promise<Blob> {
  const dir = await sessionDir(id);
  const file = await dir.getFileHandle("audio.wav");
  return file.getFile();
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
