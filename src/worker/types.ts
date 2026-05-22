// Voice IDs are referenced from React components, storage, and the worker.
// Keeping the type here avoids cyclic worker imports in non-worker code paths.
export type VoiceId = "af_heart" | "af_bella" | "am_michael" | "am_eric";
