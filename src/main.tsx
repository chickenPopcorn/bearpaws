import React, {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
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
import { SPEED_PERCENT, type Feedback, type Mode } from "./engine";
import { FingerGuide } from "./FingerGuide";
import { SongLibrary } from "./SongLibrary";
import { PianoSoundControls } from "./PianoSoundControls";
import type { PianoVoice } from "./pianoSound";
import { SheetTimeline } from "./SheetTimeline";
import { LoopBoundInput } from "./LoopBoundInput";
import { describeWaitTarget } from "./waitTarget";
import { usePianoFullscreen } from "./usePianoFullscreen";
import { usePracticeShortcuts } from "./usePracticeShortcuts";
import { bookForSong, songsInBook } from "./books";
import { PracticeCalendar, useLocalDay } from "./PracticeCalendar";
import { BrowserStorageError, CloudSync, UnsentChangesError } from "./cloud";
import { StudioClaim } from "./studioClaim";
import { OpeningStudio } from "./OpeningStudio";
import { SignIn } from "./SignIn";
import { firstName, signInWithGoogle, supabase } from "./supabase";
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
const practiceDay = () => studio.practiceLog.today();
const setLearnerName = (name: string) => studio.learnerName(name);
const setDailyGoal = (minutes: number) => studio.dailyGoal(minutes);
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
        studio.duetNotes,
      ),
    );
  }, []);
  const press = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect(),
      x = (e.clientX - rect.left) / rect.width,
      y = e.clientY - rect.top;
    const pitch = pianoKeyAt(
      studio.song,
      x,
      y,
      rect.height,
      studio.duetNotes.length > 0,
    );
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
  duet,
  hasDuet,
}: {
  mode: Mode;
  left: boolean;
  right: boolean;
  duet: boolean;
  hasDuet: boolean;
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
        <button
          aria-pressed={duet && hasDuet}
          disabled={!hasDuet}
          title={
            hasDuet
              ? "Teacher duet plays along. Your piano is never scored on it."
              : "This song has no duet part"
          }
          onClick={() => studio.duet()}
        >
          <span className="swatch duet" />
          Duet
        </button>
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
const KeyboardHelp = memo(function KeyboardHelp({
  shift,
}: {
  /** Semitones the keys move with the student part, as with Duet on. */
  shift: number;
}) {
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
          {Object.entries(shortcuts).map(([key, written]) => {
            const pitch = written + shift;
            return (
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
            );
          })}
        </div>
      )}
    </details>
  );
});
function App({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  useSyncExternalStore(studio.subscribe, studio.snapshot);
  const [connectTried, setConnectTried] = useState(false),
    [busy, setBusy] = useState(false);
  const fullscreen = usePianoFullscreen(() => {
    if (!studio.transport.playing && !busy) void startPlayback();
  });
  const s = studio.settings,
    p = studio.practice,
    playing = studio.transport.playing;
  const connected = studio.midi.status === "connected",
    connecting = studio.midi.status === "opening",
    selectedDevice = studio.midi.devices.find(
      (d) => d.id === studio.midi.selectedId,
    );
  const book = bookForSong(studio.song);
  const bookSongs = songsInBook(studio.songs, book.id);
  const songIndex = bookSongs.findIndex((song) => song.id === studio.song.id);
  const previousSong = bookSongs[songIndex - 1];
  const nextSong = bookSongs[songIndex + 1];
  useEffect(() => {
    studio.init();
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
        // With Duet on, the keys follow the student part up.
        studio.virtual(pitch + studio.octaveShift, true);
      }
    };
    const up = (e: KeyboardEvent) => {
      const key = shortcuts[e.key.toLowerCase()];
      const pitch = key === undefined ? undefined : key + studio.octaveShift;
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
      if (document.hidden) studio.pause();
    };
    const save = () => {
      // Also cancel starts still opening audio/MIDI, and release hardware notes.
      studio.pause();
      saveReloadSnapshot(document.getElementById("root")!, currentUser ?? "");
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
  const today = useLocalDay(practiceDay);
  // Totals change at most once a second, when a day gains a whole second.
  const practiceRevision = studio.practiceLog.revision;
  const practiceTotals = useMemo(
    () => studio.practiceLog.totals(),
    [practiceRevision, today],
  );
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
          <span className="brand-name" aria-hidden="true">
            <span className="brand-initial">P</span>aw{" "}
            <span className="brand-initial">P</span>al
          </span>
        </a>
        <span className="eyebrow">A little practice. Every day.</span>
        <div className="device-group">
          {/* Several inputs (a piano plus a controller or virtual port) need a choice. */}
          {studio.midi.devices.length > 1 && (
            <select
              aria-label="MIDI input device"
              value={studio.midi.selectedId}
              onChange={(e) => studio.midi.select(e.target.value)}
            >
              {!selectedDevice && (
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
          {connected ? (
            <span className="device" title={selectedDevice?.name}>
              <span className="dot connected" />
              Piano connected
            </span>
          ) : (
            <button
              className="device"
              disabled={connecting}
              onClick={() => {
                setConnectTried(true);
                void studio.midi.connect();
              }}
            >
              <span className="dot" />
              {connecting ? "Connecting…" : "Connect your piano"}
            </button>
          )}
        </div>
        {/* Keep output selection and retry available without an input. */}
        {(connected ||
          studio.midi.outputs.length > 0 ||
          studio.midi.selectedOutputId) && (
          <label>
            Duet sound
            <select
              aria-label="Duet sound"
              disabled={studio.outputChanging}
              value={studio.midi.selectedOutputId}
              onChange={(e) => void studio.duetOutput(e.target.value)}
            >
              <option value="">Laptop</option>
              {studio.midi.outputs.map((port) => (
                <option key={port.id} value={port.id}>
                  {port.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="account"
          title={email ? `Signed in as ${email}` : undefined}
          onClick={onSignOut}
        >
          Sign out
        </button>
      </header>
      <p className="sr-only" role="status">
        {studio.midi.message}
      </p>
      {studio.midi.outputMessage && (
        <p className="connection" role="status">
          {studio.midi.outputMessage}
        </p>
      )}
      {/* After a click, say why the piano is not connected yet. */}
      {connectTried && !connected && !connecting && (
        <p className="connection">{studio.midi.message}</p>
      )}
      <div className="body">
        <aside className="sidebar">
          <PracticeCalendar
            totals={practiceTotals}
            today={today}
            learnerName={s.learnerName}
            goalMinutes={s.dailyGoalMinutes}
            onLearnerName={setLearnerName}
            onGoalMinutes={setDailyGoal}
          />
          <SongLibrary
            songs={studio.songs}
            selected={studio.song.id}
            savedSelection={studio.savedSelection}
            onSelect={selectSong}
          />
          <p className="privacy">Progress syncs to your account.</p>
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
                  `${studio.song.tracks.filter((t) => t.count).length} note tracks · ${studio.song.tempos.length || 1} tempo events`
                )}
              </p>
            </div>
            <div className="song-tools">
              <span className="chip">{book.title}</span>
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
                    <div className="fullscreen-book">
                      {book.title} · {songIndex + 1} of {bookSongs.length}
                    </div>
                  </div>
                )}
                <PracticeControls
                  mode={s.mode}
                  left={s.left}
                  right={s.right}
                  duet={s.duet}
                  hasDuet={!!studio.song.duet}
                />
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
                    disabled={busy || studio.outputChanging}
                    aria-busy={busy || studio.outputChanging}
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
                <div className="playback-cluster">
                  <div
                    className="playback-status"
                    role="group"
                    aria-label="Speed and position"
                  >
                    <label className="speed">
                      <span className="speed-label">Speed</span>
                      <input
                        aria-label="Playback speed"
                        title="Playback speed"
                        type="range"
                        min={SPEED_PERCENT.min}
                        max={SPEED_PERCENT.max}
                        step={SPEED_PERCENT.step}
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
                  <button
                    className="fullscreen-toggle"
                    aria-label={
                      fullscreen.expanded
                        ? "Exit full screen"
                        : "Full screen piano"
                    }
                    aria-expanded={fullscreen.expanded}
                    aria-controls="piano-stage"
                    aria-keyshortcuts={fullscreen.expanded ? "Escape" : "Enter"}
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
                    {/* Icon only beside the controls, so they fit one row. */}
                    {fullscreen.expanded && "Exit full screen"}
                  </button>
                </div>
                {fullscreen.expanded && (
                  <div
                    className="song-navigation"
                    role="group"
                    aria-label="Book navigation"
                  >
                    <button
                      aria-label="Previous song"
                      aria-keyshortcuts="ArrowLeft"
                      title={
                        previousSong
                          ? `Previous: ${previousSong.title} (Left arrow)`
                          : "First song in this book"
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
                          : "Last song in this book"
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
              {studio.duetNotes.length > 0 && (
                <p className="duet-note">
                  <span className="swatch duet" /> Duet: the teacher part plays
                  along.{" "}
                  {studio.octaveShift
                    ? `Play ${Math.abs(studio.octaveShift) > 12 ? "two octaves" : "one octave"} ${studio.octaveShift > 0 ? "higher" : "lower"}, as the book shows.`
                    : "Play as written."}
                </p>
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
                song={studio.written}
                octaves={studio.octaveShift / 12}
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
            <PianoSoundControls
              ambience={s.ambience}
              onChange={setAmbience}
              voices={s.pianoVoices}
              onVoiceChange={setPianoVoice}
            />
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
          <KeyboardHelp shift={studio.octaveShift} />
          <footer>
            Practice syncs to your account.{" "}
            <span>USB MIDI · Desktop Chrome / Edge · HTTPS required</span>
            <span className="footer-separator" aria-hidden="true">
              ·
            </span>
            <a
              href={`${import.meta.env.BASE_URL}audio/accurate-salamander/CREDITS.md`}
            >
              Accurate-Salamander · 8 layers · sound credits
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
  | { status: "elsewhere" }
  | { status: "failed"; error: string }
  | { status: "signed-out"; error: string }
  | { status: "ready"; userId: string; email: string };

// Sign-in runs outside React, from the moment the page loads, so a refresh
// can keep the page as it was left on screen until the studio is ready.
const container = document.getElementById("root")!;
/** After a refresh, src/reloadSnapshot.ts has put the page as it was left back. */
const snapshotOnScreen = container.hasChildNodes();
let gate: Gate = { status: "loading" };
const gateListeners = new Set<() => void>();
let settle!: () => void;
/** Resolves once sign-in has decided what to show first. */
const settled = new Promise<void>((resolve) => (settle = resolve));
function setGate(next: Gate) {
  gate = next;
  if (next.status !== "loading") settle();
  for (const listener of gateListeners) listener();
}
const subscribeGate = (listener: () => void) => {
  gateListeners.add(listener);
  return () => gateListeners.delete(listener);
};
// The user whose studio is open or opening: null until the first auth event
// says whether anyone is signed in, and "" once nobody is.
let currentUser: string | null = null;

/** The public URL of a file in the song library bucket. */
const libraryUrl = (path: string) =>
  `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/${LIBRARY_BUCKET}/${path}`;
let library: Promise<Song[]> | undefined;
/** The song library, loaded once per page; a failed load is tried again. */
function loadSongs() {
  library ??= loadLibrary(libraryUrl).catch((error) => {
    library = undefined;
    throw error;
  });
  return library;
}
/** The open studio's session, to return to if sign-out fails. */
let readyGate: Extract<Gate, { status: "ready" }> | null = null;
/** The sign-in still loading, so a newer auth event can stop it. */
let loading: CloudSync | null = null;
let currentEmail = "";
/** The account's first name, the learner's name until someone changes it. */
let currentName = "";
/** This tab's claim on the studio, which only one tab runs at a time. */
const claim = new StudioClaim(() => {
  // Another tab took the studio over, and with it the stored upload queue.
  // The final save stays in this tab's memory, and its progress is sent
  // from here before syncing stops (see CloudSync.handOff()).
  loading?.stop();
  loading = null;
  if (cloud) {
    const sync = cloud;
    cloud = null;
    sync.detach();
    studio.destroy();
    void sync.handOff();
  }
  if (currentUser) setGate({ status: "elsewhere" });
});

async function openSession(userId: string, email: string, name = "") {
  if (userId === currentUser) return;
  currentUser = userId;
  loading?.stop();
  loading = null;
  // The session ended or changed outside this page's Sign out button, such as
  // in another tab: close the studio and stop its sync, so nothing more is
  // sent for the old session. Supabase has already signed out.
  if (cloud) {
    studio.destroy();
    cloud.stop();
    cloud = null;
  }
  if (!userId) {
    claim.give();
    setGate({ status: "signed-out", error: "" });
    return;
  }
  currentEmail = email;
  currentName = name;
  const claimed = await claim.claim();
  if (currentUser !== userId) {
    // A newer auth event moved on while the claim was pending. A lock that
    // arrived anyway goes to the session now current, or back to other tabs.
    if (claimed && claim.held && !cloud && !loading)
      if (!currentUser) claim.give();
      else if (gate.status === "elsewhere")
        await openStudio(currentUser, currentEmail);
    return;
  }
  if (!claimed) {
    setGate({ status: "elsewhere" });
    return;
  }
  await openStudio(userId, email);
}

/** Take the studio over from another tab. */
async function useHere() {
  const userId = currentUser;
  if (!userId) return;
  await claim.claim(true);
  if (currentUser === userId && !cloud && !loading)
    await openStudio(userId, currentEmail);
}

/** Load the account and the library, then open the studio. */
async function openStudio(userId: string, email: string) {
  const client = supabase!;
  setGate({ status: "loading" });
  const sync = new CloudSync(client, userId);
  loading = sync;
  let songs: Song[];
  try {
    [songs] = await Promise.all([loadSongs(), sync.pull()]);
  } catch (error) {
    // Replaced meanwhile, or another tab took the studio over: that state
    // stays on screen.
    if (currentUser !== userId || loading !== sync) return;
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
  if (currentUser !== userId || loading !== sync) return;
  loading = null;
  cloud = sync;
  studio = new Studio(songs, sync);
  sync.onChange = () => studio.emit();
  // Signed in, the learner has a name from the start: the account's.
  // Once only: a name cleared on purpose stays blank.
  if (
    !studio.settings.learnerNameChosen &&
    !studio.settings.learnerName.trim() &&
    currentName
  )
    studio.learnerName(currentName);
  readyGate = { status: "ready", userId, email };
  setGate(readyGate);
}

/**
 * Sign `sync` out. If some practice has not reached the account, ask before
 * dropping it; throws, still signed in, if the answer is no or sign-out fails.
 */
async function endSession(sync: CloudSync) {
  try {
    await sync.signOut();
  } catch (error) {
    if (
      !(error instanceof UnsentChangesError) ||
      !window.confirm(
        `${error.message} Sign out anyway? It will be lost on this browser.`,
      )
    )
      throw error;
    await sync.signOut({ force: true });
  }
  claim.give();
}

async function signOut() {
  if (!cloud) return;
  const sync = cloud;
  // Close the studio first: its final save joins the upload, and nothing can
  // change while signing out.
  studio.destroy();
  setGate({ status: "signing-out" });
  try {
    await endSession(sync);
  } catch (error) {
    // Still signed in: reopen the studio, and say why, unless another tab
    // has since opened a different session here.
    if (cloud !== sync) return;
    studio.notice =
      error instanceof UnsentChangesError
        ? "Still signed in. Your practice keeps trying to reach your account."
        : "Sign-out failed. Check your connection and try again.";
    if (readyGate) setGate(readyGate);
    return;
  }
  // Another tab may have changed the session while this one signed out: then
  // the newer session's studio and sync are not this sign-out's to close.
  if (cloud !== sync) return;
  cloud = null;
  currentUser = "";
  setGate({ status: "signed-out", error: "" });
}

/** Sign out of a sign-in that could not finish loading. */
async function leaveFailedSignIn() {
  const sync = loading;
  if (!sync) return;
  const failed = gate;
  setGate({ status: "signing-out" });
  try {
    await endSession(sync);
  } catch (error) {
    if (loading !== sync) return;
    setGate(
      failed.status === "failed" && !(error instanceof UnsentChangesError)
        ? {
            ...failed,
            error: "Sign-out failed. Check your connection and try again.",
          }
        : failed,
    );
    return;
  }
  // The auth event may already have moved on to a newer session.
  if (loading !== sync) return;
  loading = null;
  currentUser = "";
  setGate({ status: "signed-out", error: "" });
}

if (supabase) {
  // Supabase asks that auth callbacks not await its own calls directly.
  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(
      () =>
        void openSession(
          session?.user.id ?? "",
          session?.user.email ?? "",
          firstName(session?.user),
        ),
      0,
    );
  });
} else {
  setGate({
    status: "signed-out",
    error: "Sign-in is not set up for this site.",
  });
}

/** Shows sign-in, loading and errors, then the studio. */
function Root() {
  const current = useSyncExternalStore(subscribeGate, () => gate);
  if (current.status === "ready")
    return (
      <App
        key={current.userId}
        email={current.email}
        onSignOut={() => void signOut()}
      />
    );
  if (current.status === "loading") return <OpeningStudio error="" />;
  if (current.status === "signing-out")
    return <OpeningStudio error="" message="Signing out…" />;
  if (current.status === "elsewhere")
    return (
      <OpeningStudio
        error="Paw Pal is open in another tab. Practice there, or move it here."
        action={{ label: "Use here", onClick: () => void useHere() }}
      />
    );
  if (current.status === "failed")
    return (
      <OpeningStudio
        error={current.error}
        onSignOut={() => void leaveFailedSignIn()}
      />
    );
  return (
    <SignIn
      error={current.error}
      onSignIn={async () => {
        const { error } = await signInWithGoogle();
        if (error) throw error;
      }}
    />
  );
}

const root = createRoot(container);
const render = () => root.render(<Root />);
// While the page as it was left is on screen, keep it there until sign-in
// settles (briefly), so the first render shows the studio rather than a
// loading screen. With nothing on screen, rendering now beats a blank wait.
if (!snapshotOnScreen) render();
else
  void Promise.race([
    settled,
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]).then(render);
