import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import { Studio } from "./controller";
import { draw, pianoKeyAt } from "./render";
import { watchCanvasRedraws } from "./canvasRedraw";
import { saveReloadSnapshot } from "./reloadSnapshot";
import { noteName, type Hand, type Song } from "./song";
import type { Feedback, Mode } from "./engine";
import { FingerGuide } from "./FingerGuide";
import { SongLibrary } from "./SongLibrary";
import { PianoSoundControls } from "./PianoSoundControls";
import type { PianoVoice } from "./pianoSound";
import { SheetTimeline } from "./SheetTimeline";
import { LoopBoundInput } from "./LoopBoundInput";
import { describeWaitTarget } from "./waitTarget";
import { usePianoFullscreen } from "./usePianoFullscreen";
import { usePracticeShortcuts } from "./usePracticeShortcuts";
import { collectionForSong, songsInCollection } from "./collections";
import { BrowserStorageError, CloudSync } from "./cloud";
import { OpeningStudio, SignIn } from "./SignIn";
import { signInWithGoogle, supabase } from "./supabase";
import { LIBRARY_BUCKET, loadLibrary } from "./library";
import "./style.css";
// One studio per signed-in session, created once the account's songs and
// progress are on this browser. App only renders while it exists.
let studio!: Studio;
let cloud: CloudSync | null = null;
/** Storage serves `?download=` as an attachment, which cross-origin links need. */
const downloadUrl = (midi: string, id: string) => {
  const url = new URL(midi);
  url.searchParams.set("download", `${id}.mid`);
  return url.toString();
};
const stamp = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
// The studio is a singleton, so these stay stable and let memoized views skip
// the 50 updates a second that playback makes.
const selectSong = (song: Song | undefined) => {
  if (!song) return;
  studio.save();
  studio.load(song);
};
const seek = (position: number) => studio.seek(position);
const setAmbience = (ambience: number) => studio.sound(ambience);
const setPianoVoice = (voice: PianoVoice, enabled: boolean) =>
  studio.pianoVoice(voice, enabled);

function SongTitle({ title }: { title: string }) {
  const letter = /\p{L}/u.exec(title);
  if (!letter) return <>{title}</>;
  return (
    <>
      <span className="sr-only">{title}</span>
      <span aria-hidden="true">
        {title.slice(0, letter.index)}
        <span className="song-title-initial">{letter[0]}</span>
        {title.slice(letter.index + letter[0].length)}
      </span>
    </>
  );
}

const shortcuts: Record<string, number> = {
  z: 48,
  x: 50,
  c: 52,
  v: 53,
  b: 55,
  n: 57,
  m: 59,
  a: 60,
  w: 61,
  s: 62,
  e: 63,
  d: 64,
  f: 65,
  t: 66,
  g: 67,
  y: 68,
  h: 69,
  u: 70,
  j: 71,
  k: 72,
};
const Piano = memo(function Piano() {
  const canvas = useRef<HTMLCanvasElement>(null),
    pointers = useRef(new Map<number, number>());
  // Paint before the first frame shows, so the piano never appears blank.
  useLayoutEffect(() => {
    const element = canvas.current!;
    return watchCanvasRedraws(element, studio.subscribe, () =>
      draw(
        element,
        studio.song,
        studio.notes,
        studio.position,
        studio.input,
        studio.practice,
        studio.settings.names,
        studio.settings.mode === "wait" && studio.transport.playing,
        studio.settings.mode === "listen",
      ),
    );
  }, []);
  const press = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect(),
      x = (e.clientX - rect.left) / rect.width,
      y = e.clientY - rect.top;
    const pitch = pianoKeyAt(studio.song, x, y, rect.height);
    if (pitch !== undefined) {
      e.currentTarget.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, pitch);
      studio.virtual(pitch, true);
    }
  };
  const release = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pointers.current.get(e.pointerId);
    if (p !== undefined) {
      studio.virtual(p, false);
      pointers.current.delete(e.pointerId);
    }
  };
  return (
    <canvas
      ref={canvas}
      className="piano"
      role="img"
      aria-label="Piano waterfall aligned to keyboard. Lavender: right hand. Teal: left hand. Use your MIDI piano, computer shortcuts, or the on-screen keyboard."
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    />
  );
});
/** Where the mode switcher's highlight sits, measured from the active button. */
function useActiveIndicator(
  group: React.RefObject<HTMLElement | null>,
  active: string,
) {
  const [indicator, setIndicator] = useState<{ left: number; width: number }>();
  useLayoutEffect(() => {
    const element = group.current;
    if (!element) return;
    const measure = () => {
      const button = element.querySelector<HTMLElement>(
        '[aria-pressed="true"]',
      );
      if (button)
        setIndicator({ left: button.offsetLeft, width: button.offsetWidth });
    };
    measure();
    // Labels change width when fonts load or the layout wraps.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [group, active]);
  return indicator;
}
const PracticeControls = memo(function PracticeControls({
  mode,
  left,
  right,
}: {
  mode: Mode;
  left: boolean;
  right: boolean;
}) {
  const tabs = useRef<HTMLDivElement>(null);
  const indicator = useActiveIndicator(tabs, mode);
  return (
    <div className="toolbar-preferences">
      <div
        ref={tabs}
        className={`tabs${indicator ? " has-indicator" : ""}`}
        role="group"
        aria-label="Practice mode"
      >
        {indicator && (
          <span
            className="tabs-indicator"
            aria-hidden="true"
            style={{
              transform: `translateX(${indicator.left}px)`,
              width: indicator.width,
            }}
          />
        )}
        {(["listen", "wait", "rhythm"] as const).map((option) => (
          <button
            key={option}
            aria-pressed={mode === option}
            onClick={() => studio.mode(option)}
          >
            {option === "wait"
              ? "Wait for me"
              : option === "listen"
                ? "Listen"
                : "Rhythm"}
          </button>
        ))}
      </div>
      <div className="hands" role="group" aria-label="Practice hands">
        {(["left", "right"] as const).map((hand) => (
          <button
            key={hand}
            aria-pressed={hand === "left" ? left : right}
            onClick={() => studio.hand(hand)}
          >
            <span className={`swatch ${hand}`} />
            {hand === "left" ? "Left" : "Right"}
          </button>
        ))}
      </div>
    </div>
  );
});
const PassagePanel = memo(function PassagePanel({
  song,
  loopStart,
  loopEnd,
}: {
  song: Song;
  loopStart: number;
  loopEnd: number;
}) {
  return (
    <section className="panel" aria-label="Tracks and passage">
      <div className="panel-heading">
        Make it yours <span>Tracks & passage</span>
      </div>
      <div className="assignments">
        {song.tracks
          .filter((t) => t.count)
          .map((track) => (
            <label key={track.id}>
              <span>
                {track.name}
                <small>{track.count} notes</small>
              </span>
              <select
                aria-label={`Hand for ${track.name}`}
                value={track.hand}
                onChange={(e) =>
                  studio.assign(track.id, e.target.value as Hand)
                }
              >
                <option value="off">Skip</option>
                <option value="left">Left hand</option>
                <option value="right">Right hand</option>
              </select>
            </label>
          ))}
      </div>
      <p className="small">
        Choose hands explicitly. Track names are only suggestions. A single
        track can be assigned to one hand.
      </p>
      <div className="loop-fields">
        <label>
          From{" "}
          <LoopBoundInput
            key={song.id}
            label="Loop start seconds"
            value={loopStart}
            min={0}
            max={loopEnd - 0.2}
            onCommit={(start) => studio.bounds(start, studio.loopEnd)}
          />
          <span>s</span>
        </label>
        <button
          title="Set loop start to current position"
          onClick={() => studio.bounds(studio.position, studio.loopEnd)}
        >
          Set A
        </button>
        <label>
          To{" "}
          <LoopBoundInput
            key={song.id}
            label="Loop end seconds"
            value={loopEnd}
            min={loopStart + 0.2}
            max={song.duration}
            onCommit={(end) => studio.bounds(studio.loopStart, end)}
          />
          <span>s</span>
        </label>
        <button
          title="Set loop end to current position"
          onClick={() => studio.bounds(studio.loopStart, studio.position)}
        >
          Set B
        </button>
      </div>
      {song.warnings.map((w) => (
        <p className="small" key={w}>
          {w}
        </p>
      ))}
      {!song.library && (
        <button className="text-button" onClick={() => void studio.remove()}>
          Remove this local song
        </button>
      )}
    </section>
  );
});
// `misses` grows in place, but always together with a new `recent` item.
const PracticeReview = memo(function PracticeReview({
  recent,
  misses,
  matched,
  missed,
  wrong,
  timing,
  attempts,
  best,
}: {
  recent: Feedback | undefined;
  misses: readonly Feedback[];
  matched: number;
  missed: number;
  wrong: number;
  timing: number | undefined;
  attempts: number;
  best: number;
}) {
  return (
    <section className="panel feedback" aria-label="Practice review">
      <div className="panel-heading">
        A little better each time <span>Practice review</span>
      </div>
      <div className="stats">
        <div>
          <strong>{matched}</strong>
          <span>Matched</span>
        </div>
        <div>
          <strong>{missed}</strong>
          <span>Missed</span>
        </div>
        <div>
          <strong>{timing === undefined ? "—" : timing + " ms"}</strong>
          <span>Average timing error</span>
        </div>
      </div>
      <p className="small">
        {recent
          ? recent.kind === "wrong"
            ? `Try the highlighted notes. ${noteName(recent.pitch)} wasn’t in the timing window.`
            : recent.kind === "miss"
              ? `Missed ${noteName(recent.pitch)} at ${stamp(recent.at)}.`
              : recent.kind === "hit"
                ? "That’s it. Keep going."
                : `Matched ${noteName(recent.pitch)} · ${Math.abs(Math.round((recent.offset || 0) * 1000))} ms ${recent.kind}, within tolerance.`
          : "Your note and timing feedback will appear here. Wait for me checks notes; Rhythm adds timing."}
      </p>
      {misses.length > 0 && (
        <div className="misses">
          {misses.map((m, i) => (
            <button
              key={i}
              title="Replay around this missed note"
              onClick={() => {
                studio.bounds(
                  Math.max(0, m.at - 1),
                  Math.min(studio.song.duration, m.at + 2),
                );
                studio.loop(true);
              }}
            >
              {noteName(m.pitch)} · {stamp(m.at)} ↺
            </button>
          ))}
        </div>
      )}
      <div className="progress-note">
        {wrong} wrong presses · {attempts} starts saved · Best matched {best}%
        <span>Skipped notes are excluded after seeking.</span>
      </div>
    </section>
  );
});
const KeyboardHelp = memo(function KeyboardHelp() {
  const [showKeys, setShowKeys] = useState(false);
  return (
    <details
      className="keyboard-help"
      onToggle={(e) => setShowKeys(e.currentTarget.open)}
    >
      <summary>
        Try the on-screen keys <span>or use your computer keyboard</span>
      </summary>
      <p>
        Left hand: Z X C V B N M · Right hand: A W S E D F T G Y H U J K. You
        can also click the piano keys. These are practice inputs; your USB piano
        supplies its own live sound. A teal dot marks sound held by the pedal
        after key release.
      </p>
      {showKeys && (
        <div className="accessible-keys">
          {Object.entries(shortcuts).map(([key, pitch]) => (
            <button
              key={key}
              aria-label={`Play ${noteName(pitch)}`}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                studio.virtual(pitch, true);
              }}
              onPointerUp={() => studio.virtual(pitch, false)}
              onPointerCancel={() => studio.virtual(pitch, false)}
              onLostPointerCapture={() => studio.virtual(pitch, false)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
                  e.preventDefault();
                  studio.virtual(pitch, true);
                }
              }}
              onKeyUp={(e) => {
                if (e.key === "Enter" || e.key === " ")
                  studio.virtual(pitch, false);
              }}
            >
              {noteName(pitch)}
              <small>{key.toUpperCase()}</small>
            </button>
          ))}
        </div>
      )}
    </details>
  );
});
function App({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  useSyncExternalStore(studio.subscribe, studio.snapshot);
  const [deviceOpen, setDeviceOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const openImport = useCallback(() => file.current?.click(), []);
  const fullscreen = usePianoFullscreen(() => {
    if (!studio.transport.playing && !busy) void startPlayback();
  });
  const s = studio.settings,
    p = studio.practice,
    playing = studio.transport.playing;
  const connected = studio.midi.status === "connected";
  const collection = collectionForSong(studio.song);
  const collectionSongs = songsInCollection(studio.songs, collection.id);
  const songIndex = collectionSongs.findIndex(
    (song) => song.id === studio.song.id,
  );
  const previousSong = collectionSongs[songIndex - 1];
  const nextSong = collectionSongs[songIndex + 1];
  useEffect(() => {
    void studio.init();
    const down = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          "input,select,textarea,[contenteditable=true]",
        ) ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.repeat
      )
        return;
      const pitch = shortcuts[e.key.toLowerCase()];
      if (pitch !== undefined) {
        e.preventDefault();
        studio.virtual(pitch, true);
      }
    };
    const up = (e: KeyboardEvent) => {
      const pitch = shortcuts[e.key.toLowerCase()];
      if (pitch !== undefined && studio.input.down.has(pitch)) {
        studio.virtual(pitch, false);
      }
    };
    const blur = () => {
      studio.input.clear();
      if (studio.transport.playing && studio.settings.mode !== "listen")
        studio.pause();
      else studio.emit();
    };
    const hidden = () => {
      if (document.hidden && studio.transport.playing) studio.pause();
    };
    const save = () => {
      studio.save();
      saveReloadSnapshot(document.getElementById("root")!);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      studio.destroy();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  const stageNotice = studio.audio.loading
    ? "Loading grand piano sound…"
    : studio.notice;
  const startPlayback = async () => {
    setBusy(true);
    try {
      await studio.play();
    } finally {
      setBusy(false);
    }
  };
  const toggle = async () => {
    if (busy) return;
    if (studio.transport.playing) studio.pause();
    else await startPlayback();
  };
  const navigateSong = async (song: Song | undefined) => {
    if (!song || busy) return;
    selectSong(song);
    await startPlayback();
  };
  usePracticeShortcuts({
    expanded: fullscreen.expanded,
    busy,
    onEnter: () => void fullscreen.enter(),
    onTogglePlayback: () => void toggle(),
    onPreviousSong: () => void navigateSong(previousSong),
    onNextSong: () => void navigateSong(nextSong),
  });
  const misses = p.recentMisses,
    stats = p.stats,
    recent = p.feedback.at(-1);
  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="./" aria-label="Paw Pal home">
          <img
            className="brand-mark"
            src={`${import.meta.env.BASE_URL}bearpaws.svg?v=3`}
            alt=""
            width="40"
            height="40"
          />
          Paw Pal
        </a>
        <span className="eyebrow">A little practice. Every day.</span>
        <button
          className="device"
          aria-expanded={deviceOpen}
          onClick={() => setDeviceOpen(!deviceOpen)}
        >
          <span className={`dot ${connected ? "connected" : ""}`} />
          {connected ? "Piano connected" : "Connect your piano"}
          <svg
            className="device-chevron"
            viewBox="0 0 12 12"
            aria-hidden="true"
          >
            <path d="m2.5 7.5 3.5-3.5 3.5 3.5" />
          </svg>
        </button>
        <button
          className="account"
          title={email ? `Signed in as ${email}` : undefined}
          onClick={onSignOut}
        >
          Sign out
        </button>
      </header>
      {/* Connection changes are announced even while the panel is folded. */}
      <p className="sr-only" role="status">
        {studio.midi.message}
      </p>
      {deviceOpen && (
        <section className="connection" aria-label="Piano connection">
          <div>
            <strong>
              {connected ? "Your piano is ready" : "Make room for music"}
            </strong>
            <p>{studio.midi.message}</p>
          </div>
          <div className="device-actions">
            {studio.midi.devices.length > 0 && (
              <select
                aria-label="MIDI input device"
                value={studio.midi.selectedId}
                onChange={(e) => studio.midi.select(e.target.value)}
              >
                {!studio.midi.devices.some(
                  (d) => d.id === studio.midi.selectedId,
                ) && (
                  <option value={studio.midi.selectedId}>
                    Disconnected input
                  </option>
                )}
                {studio.midi.devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
            <button onClick={() => void studio.midi.connect()}>
              Connect piano
            </button>
          </div>
        </section>
      )}
      <div className="body">
        <aside className="sidebar">
          <SongLibrary
            songs={studio.songs}
            selected={studio.song.id}
            onSelect={selectSong}
            onImport={openImport}
          />
          <input
            ref={file}
            className="sr-only"
            type="file"
            accept=".mid,.midi,audio/midi,audio/x-midi"
            aria-label="Import MIDI file"
            onChange={(e) => {
              if (e.target.files?.[0]) void studio.import(e.target.files[0]);
              e.target.value = "";
            }}
          />
          <p className="privacy">
            Imported songs stay on this browser.
            <br />
            Progress syncs to your account.
          </p>
          <div className="side-footer">
            <strong>One phrase at a time.</strong>Slow it down.
            <br />
            Find your rhythm.
          </div>
        </aside>
        <main>
          <div className="song-head">
            <div>
              <div className="kicker">Practice studio</div>
              <h1>
                <SongTitle title={studio.song.title} />
              </h1>
              <p>
                {studio.song.source ? (
                  <>
                    {studio.song.source.composer} ·{" "}
                    {studio.song.source.description}{" "}
                    <a
                      href={studio.song.source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      MIDI by {studio.song.source.credit}
                    </a>
                  </>
                ) : studio.song.lesson ? (
                  `${studio.song.lesson.composer} · ${studio.song.lesson.description}`
                ) : (
                  `${studio.song.tracks.filter((t) => t.count).length} note tracks · ${studio.song.tempos.length || 1} tempo events · Local MIDI`
                )}
              </p>
            </div>
            <div className="song-tools">
              <span className="chip">
                {studio.song.library
                  ? "Shared library"
                  : "Saved on this browser"}
              </span>
              {studio.song.library?.midi && (
                <a
                  className="song-midi-download"
                  href={downloadUrl(studio.song.library.midi, studio.song.id)}
                  download
                  aria-label={`Download ${studio.song.title} MIDI`}
                >
                  Download MIDI
                </a>
              )}
            </div>
          </div>
          {studio.storageNotice && (
            <p className="alert" role="status">
              {studio.storageNotice}
            </p>
          )}
          {cloud?.error && (
            <p className="alert" role="status">
              {cloud.error}
            </p>
          )}
          <FingerGuide song={studio.song} left={s.left} right={s.right} />
          <div className="workspace">
            <div
              id="piano-stage"
              ref={fullscreen.stage}
              className={`work-main ${fullscreen.expanded ? "piano-expanded" : ""}`}
              role={fullscreen.expanded ? "dialog" : "region"}
              aria-label="Piano practice"
              aria-modal={fullscreen.expanded || undefined}
              tabIndex={-1}
            >
              <div className="practice-toolbar" aria-label="Practice controls">
                {fullscreen.expanded && (
                  <div
                    className="fullscreen-song-heading"
                    title={studio.song.title}
                  >
                    <strong className="fullscreen-song-title">
                      <SongTitle title={studio.song.title} />
                    </strong>
                    <div className="fullscreen-collection">
                      {collection.title} · {songIndex + 1} of{" "}
                      {collectionSongs.length}
                    </div>
                  </div>
                )}
                <PracticeControls mode={s.mode} left={s.left} right={s.right} />
                <div
                  className="transport-buttons"
                  role="group"
                  aria-label="Playback"
                >
                  <button
                    className="square"
                    aria-label="Restart passage"
                    title="Restart passage"
                    onClick={() => studio.seek(0)}
                  >
                    ↺
                  </button>
                  <button
                    className="primary play"
                    disabled={busy}
                    aria-busy={busy}
                    title={playing ? "Pause (Space)" : "Play (Space)"}
                    aria-keyshortcuts="Space"
                    onClick={() => void toggle()}
                  >
                    {busy ? "Loading…" : playing ? "Ⅱ Pause" : "▷ Play"}
                  </button>
                  <button
                    className="square"
                    aria-label="Loop passage"
                    title="Loop passage"
                    aria-pressed={studio.loopEnabled}
                    onClick={() => studio.loop(!studio.loopEnabled)}
                  >
                    ⇄
                  </button>
                </div>
                <div
                  className="playback-status"
                  role="group"
                  aria-label="Speed and position"
                >
                  <label className="speed">
                    Speed
                    <input
                      aria-label="Playback speed"
                      type="range"
                      min="25"
                      max="150"
                      step="5"
                      value={s.speed * 100}
                      onChange={(e) =>
                        studio.speed(Number(e.target.value) / 100)
                      }
                    />
                    <output>{Math.round(s.speed * 100)}%</output>
                  </label>
                  <span className="time">
                    {stamp(studio.position)} / {stamp(studio.song.duration)}
                  </span>
                </div>
                <PianoSoundControls
                  ambience={s.ambience}
                  onChange={setAmbience}
                  voices={s.pianoVoices}
                  onVoiceChange={setPianoVoice}
                />
                {fullscreen.expanded && (
                  <div
                    className="song-navigation"
                    role="group"
                    aria-label="Collection navigation"
                  >
                    <button
                      aria-label="Previous song"
                      aria-keyshortcuts="ArrowLeft"
                      title={
                        previousSong
                          ? `Previous: ${previousSong.title} (Left arrow)`
                          : "First song in this collection"
                      }
                      disabled={!previousSong || busy}
                      onClick={() => void navigateSong(previousSong)}
                    >
                      <span aria-hidden="true">←</span> Previous
                    </button>
                    <button
                      aria-label="Next song"
                      aria-keyshortcuts="ArrowRight"
                      title={
                        nextSong
                          ? `Next: ${nextSong.title} (Right arrow)`
                          : "Last song in this collection"
                      }
                      disabled={!nextSong || busy}
                      onClick={() => void navigateSong(nextSong)}
                    >
                      Next <span aria-hidden="true">→</span>
                    </button>
                  </div>
                )}
              </div>
              {stageNotice && (
                <div className="piano-notice" role="status">
                  {stageNotice}
                </div>
              )}
              {s.mode === "wait" && (
                <p className="sr-only" aria-live="polite">
                  {describeWaitTarget(
                    studio.song,
                    p.gate,
                    studio.input.down,
                    p.hit,
                  )}
                </p>
              )}
              <SheetTimeline
                song={studio.song}
                position={studio.position}
                mode={s.mode}
                hit={p.hit}
                selectedNotes={studio.notes}
                from={p.from}
                onSeek={seek}
              />
              <div className="roll">
                <div className="roll-caption">
                  <span>
                    {s.mode === "listen"
                      ? "Follow the music"
                      : s.mode === "wait"
                        ? "Your pace. Your next note."
                        : "Find your rhythm"}
                  </span>
                  <div className="roll-actions">
                    <span>5 seconds ahead</span>
                    <button
                      className="fullscreen-toggle"
                      aria-label={
                        fullscreen.expanded
                          ? "Exit full screen"
                          : "Full screen piano"
                      }
                      aria-expanded={fullscreen.expanded}
                      aria-controls="piano-stage"
                      aria-keyshortcuts={
                        fullscreen.expanded ? "Escape" : "Enter"
                      }
                      title={
                        fullscreen.expanded
                          ? "Exit full screen (Esc)"
                          : "Full screen and play (Enter)"
                      }
                      onClick={() => void fullscreen.toggle()}
                    >
                      <span aria-hidden="true">
                        {fullscreen.expanded ? "↙" : "⛶"}
                      </span>
                      {fullscreen.expanded ? "Exit full screen" : "Full screen"}
                    </button>
                  </div>
                </div>
                <Piano />
              </div>
            </div>
          </div>
          <div className="settings-row">
            <label>
              Timing tolerance{" "}
              <select
                aria-label="Timing tolerance"
                value={s.tolerance}
                onChange={(e) => studio.tolerance(Number(e.target.value))}
              >
                <option value="0.12">Focused · ±120 ms</option>
                <option value="0.22">Relaxed · ±220 ms</option>
                <option value="0.35">Gentle · ±350 ms</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={s.reference}
                onChange={(e) => studio.reference(e.target.checked)}
              />{" "}
              Reference sound in Rhythm
            </label>
            <label>
              <input
                type="checkbox"
                checked={s.names}
                onChange={(e) => studio.names(e.target.checked)}
              />{" "}
              Note names
            </label>
            <span className="pedal">
              <span>
                Pedal <b>{studio.input.sustain ? "Down" : "Up"}</b>
              </span>
              <span>
                Velocity <b>{studio.lastVelocity || "—"}</b>
              </span>
            </span>
          </div>
          <section className="lower-grid">
            <PracticeReview
              recent={recent}
              misses={misses}
              matched={p.hit.size}
              missed={stats.missed}
              wrong={stats.wrong}
              timing={
                stats.timingCount
                  ? Math.round(
                      (stats.timingAbsTotal / stats.timingCount) * 1000,
                    )
                  : undefined
              }
              attempts={studio.progress.attempts}
              best={studio.progress.best}
            />
            <PassagePanel
              song={studio.song}
              loopStart={studio.loopStart}
              loopEnd={studio.loopEnd}
            />
          </section>
          <KeyboardHelp />
          <footer>
            Practice syncs to your account.{" "}
            <span>USB MIDI · Desktop Chrome / Edge · HTTPS required</span>
            <span className="footer-separator" aria-hidden="true">
              ·
            </span>
            <a
              href={`${import.meta.env.BASE_URL}audio/accurate-salamander/CREDITS.md`}
            >
              Accurate-Salamander · 16 layers · sound credits
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}
type Gate =
  | { status: "loading" }
  | { status: "signing-out" }
  | { status: "failed"; error: string }
  | { status: "signed-out"; error: string }
  | { status: "ready"; userId: string; email: string };

/** Signs the user in, loads their account, then opens the studio. */
function Root() {
  const [gate, setGate] = useState<Gate>({ status: "loading" });
  // The user whose studio is open or opening: null until the first auth
  // event says whether anyone is signed in, and "" once nobody is.
  const user = useRef<string | null>(null);
  /** The open studio's session, to return to if sign-out fails. */
  const ready = useRef<Extract<Gate, { status: "ready" }> | null>(null);
  useEffect(() => {
    const client = supabase;
    if (!client) {
      setGate({
        status: "signed-out",
        error: "Sign-in is not set up for this site.",
      });
      return;
    }
    // The sign-in still loading, so a newer auth event can stop it.
    let loading: CloudSync | null = null;
    const open = async (userId: string, email: string) => {
      if (userId === user.current) return;
      user.current = userId;
      loading?.stop();
      loading = null;
      // The session ended or changed outside this page's Sign out button, such
      // as in another tab: close the studio and stop its sync, so nothing more
      // is sent for the old session. Supabase has already signed out.
      if (cloud) {
        studio.destroy();
        cloud.stop();
        cloud = null;
      }
      if (!userId) {
        setGate({ status: "signed-out", error: "" });
        return;
      }
      setGate({ status: "loading" });
      const sync = new CloudSync(client, userId);
      loading = sync;
      let library: Song[];
      try {
        [library] = await Promise.all([
          loadLibrary(
            (path) =>
              client.storage.from(LIBRARY_BUCKET).getPublicUrl(path).data
                .publicUrl,
          ),
          sync.pull(),
        ]);
      } catch (error) {
        if (user.current !== userId) return;
        // Still signed in: offer a retry, not another Google sign-in.
        setGate({
          status: "failed",
          error:
            error instanceof BrowserStorageError
              ? error.message
              : "Your songs could not be loaded. Check your connection and try again.",
        });
        return;
      }
      if (user.current !== userId) return;
      loading = null;
      cloud = sync;
      studio = new Studio(library, sync);
      sync.onChange = () => studio.emit();
      ready.current = { status: "ready", userId, email };
      setGate(ready.current);
    };
    // Supabase asks that auth callbacks not await its own calls directly.
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setTimeout(
        () => void open(session?.user.id ?? "", session?.user.email ?? ""),
        0,
      );
    });
    return () => data.subscription.unsubscribe();
  }, []);
  const signOut = useCallback(async () => {
    if (!cloud) return;
    const sync = cloud;
    // Close the studio first: its final save joins the upload, and nothing
    // can change while signing out.
    studio.destroy();
    setGate({ status: "signing-out" });
    try {
      await sync.signOut();
    } catch {
      // Supabase still holds the session: reopen the studio, and say so.
      studio.notice = "Sign-out failed. Check your connection and try again.";
      if (ready.current) setGate(ready.current);
      return;
    }
    cloud = null;
    user.current = "";
    setGate({ status: "signed-out", error: "" });
  }, []);
  if (gate.status === "ready")
    return (
      <App
        key={gate.userId}
        email={gate.email}
        onSignOut={() => void signOut()}
      />
    );
  if (gate.status === "loading") return <OpeningStudio error="" />;
  if (gate.status === "signing-out")
    return <OpeningStudio error="" message="Signing out…" />;
  if (gate.status === "failed") return <OpeningStudio error={gate.error} />;
  return (
    <SignIn
      error={gate.error}
      onSignIn={async () => {
        const { error } = await signInWithGoogle();
        if (error) throw error;
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
