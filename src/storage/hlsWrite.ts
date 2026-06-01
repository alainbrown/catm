// Worker-safe OPFS writers for a session's HLS files. No idb/fflate so the
// worker bundle (and the demo bundle) don't drag in the metadata layer.

async function sessionDir(id: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const sessions = await root.getDirectoryHandle("sessions", { create: true });
  return sessions.getDirectoryHandle(id, { create: true });
}

async function writeBytes(id: string, name: string, bytes: Uint8Array): Promise<void> {
  const dir = await sessionDir(id);
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(new Blob([bytes as BlobPart]));
  await writable.close();
}

async function appendBytes(
  id: string,
  name: string,
  bytes: Uint8Array,
  position: number,
): Promise<void> {
  const dir = await sessionDir(id);
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable({ keepExistingData: true });
  await writable.write({ type: "write", position, data: new Blob([bytes as BlobPart]) });
  await writable.close();
}

const ENCODER = new TextEncoder();

export async function writeInit(id: string, bytes: Uint8Array): Promise<void> {
  await writeBytes(id, "init.mp4", bytes);
}

export async function writeSegment(id: string, index: number, bytes: Uint8Array): Promise<void> {
  await writeBytes(id, `seg-${index}.m4s`, bytes);
}

// EVENT playlist written incrementally: header up front, one #EXTINF line per
// segment appended at `position`, #EXT-X-ENDLIST on finalize — no full rewrite.
// Returns the new byte position. TARGETDURATION:1 makes hls.js poll ~1/sec.
export function playlistHeader(): Uint8Array {
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-TARGETDURATION:1",
    "#EXT-X-PLAYLIST-TYPE:EVENT",
    "#EXT-X-MEDIA-SEQUENCE:0",
    '#EXT-X-MAP:URI="init.mp4"',
    "",
  ];
  return ENCODER.encode(lines.join("\n"));
}

export async function writePlaylistHeader(id: string): Promise<number> {
  const bytes = playlistHeader();
  await writeBytes(id, "playlist.m3u8", bytes);
  return bytes.length;
}

export async function appendPlaylistSegment(
  id: string,
  index: number,
  durationSec: number,
  position: number,
): Promise<number> {
  const bytes = ENCODER.encode(`#EXTINF:${durationSec.toFixed(3)},\nseg-${index}.m4s\n`);
  await appendBytes(id, "playlist.m3u8", bytes, position);
  return position + bytes.length;
}

export async function appendPlaylistEnd(id: string, position: number): Promise<void> {
  await appendBytes(id, "playlist.m3u8", ENCODER.encode("#EXT-X-ENDLIST\n"), position);
}
