import { type RefObject, useEffect, useState } from "react";

function fmt(t: number): string {
  const safe = Number.isFinite(t) && t > 0 ? t : 0;
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SPEED_CYCLE = [1, 1.25, 1.5, 1.75, 2, 0.75] as const;

function nextSpeed(current: number): number {
  const idx = SPEED_CYCLE.findIndex((s) => Math.abs(s - current) < 1e-6);
  const next = SPEED_CYCLE[(idx + 1) % SPEED_CYCLE.length];
  return next ?? 1;
}

function formatSpeed(s: number): string {
  return `${s}×`;
}

interface AudioPlayerProps {
  audioRef: RefObject<HTMLAudioElement | null>;
  speed: number;
  onChangeSpeed: (s: number) => void;
}

export function AudioPlayer({
  audioRef,
  speed,
  onChangeSpeed,
}: AudioPlayerProps): React.JSX.Element {
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = (): void => setPlaying(true);
    const onPause = (): void => setPlaying(false);
    const onTime = (): void => setCurrent(a.currentTime);
    const onDur = (): void => setDuration(Number.isFinite(a.duration) ? a.duration : 0);
    const onProg = (): void => {
      if (a.buffered.length === 0) return;
      setBuffered(a.buffered.end(a.buffered.length - 1));
    };
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onPause);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("durationchange", onDur);
    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("progress", onProg);
    onDur();
    onTime();
    onProg();
    setPlaying(!a.paused);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onPause);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("durationchange", onDur);
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("progress", onProg);
    };
  }, [audioRef]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) a.playbackRate = speed;
  }, [audioRef, speed]);

  function toggle(): void {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  }

  function seekTo(clientX: number, rect: DOMRect): void {
    const a = audioRef.current;
    if (!a || !duration) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    a.currentTime = ratio * duration;
  }

  const playedPct = duration ? (current / duration) * 100 : 0;
  const preparedPct = duration ? Math.min(100, (buffered / duration) * 100) : 0;

  return (
    <div className="player-fake">
      <button
        type="button"
        className="play-btn"
        aria-label={playing ? "Pause" : "Play"}
        onClick={toggle}
      >
        {playing ? (
          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true">
            <rect x="0" y="0" width="3" height="12" />
            <rect x="7" y="0" width="3" height="12" />
          </svg>
        ) : (
          <svg width="11" height="12" viewBox="0 0 11 12" fill="currentColor" aria-hidden="true">
            <polygon points="1,0 11,6 1,12" />
          </svg>
        )}
      </button>
      <div
        className="scrub"
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(current)}
        tabIndex={0}
        onClick={(e) => seekTo(e.clientX, e.currentTarget.getBoundingClientRect())}
        onKeyDown={(e) => {
          const a = audioRef.current;
          if (!a || !duration) return;
          if (e.key === "ArrowRight") a.currentTime = Math.min(duration, a.currentTime + 5);
          else if (e.key === "ArrowLeft") a.currentTime = Math.max(0, a.currentTime - 5);
        }}
      >
        <div className="prepared" style={{ width: `${preparedPct}%` }} />
        <div className="played" style={{ width: `${playedPct}%` }} />
      </div>
      <span className="time">
        {fmt(current)} / {fmt(duration)}
      </span>
      <button
        type="button"
        className="speed-btn"
        aria-label={`Playback speed: ${formatSpeed(speed)}. Click to change.`}
        title="Playback speed"
        onClick={() => onChangeSpeed(nextSpeed(speed))}
      >
        {formatSpeed(speed)}
      </button>
    </div>
  );
}
