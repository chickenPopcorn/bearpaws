import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import { Studio } from "./controller";
import { draw, pianoKeyAt } from "./render";
import {
  noteName,
  suggestedFinger,
  fingerNames,
  type Hand,
  type Song,
} from "./song";
import { FingerGuide } from "./FingerGuide";
import { SongLibrary } from "./SongLibrary";
import { PianoSoundControls } from "./PianoSoundControls";
import { SheetTimeline } from "./SheetTimeline";
import { LoopBoundInput } from "./LoopBoundInput";
import { usePianoFullscreen } from "./usePianoFullscreen";
import { usePracticeShortcuts } from "./usePracticeShortcuts";
import { isBuiltInSong } from "./lessons";
import { collectionForSong } from "./collections";
import "./style.css";
const studio = new Studio();
const stamp = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

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
function Piano() {
  const canvas = useRef<HTMLCanvasElement>(null),
    pointers = useRef(new Map<number, number>());
  useEffect(() => {
    let frame = 0;
    const render = () => {
      if (canvas.current)
        draw(
          canvas.current,
          studio.song,
          studio.notes,
          studio.position,
          studio.input,
          studio.practice,
          studio.settings.names,
          studio.settings.mode === "wait" && studio.transport.playing,
          studio.settings.mode === "listen",
        );
      frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
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
}
function PracticeControls({
  className = "toolbar-preferences",
}: {
  className?: string;
}) {
  const s = studio.settings;
  return (
    <div className={className}>
      <div className="tabs" role="group" aria-label="Practice mode">
        {(["listen", "wait", "rhythm"] as const).map((mode) => (
          <button
            key={mode}
            aria-pressed={s.mode === mode}
            onClick={() => studio.mode(mode)}
          >
            {mode === "wait"
              ? "Wait for me"
              : mode === "listen"
                ? "Listen"
                : "Rhythm"}
          </button>
        ))}
      </div>
      <div className="hands" role="group" aria-label="Practice hands">
        {(["left", "right"] as const).map((hand) => (
          <button
            key={hand}
            aria-pressed={s[hand]}
            onClick={() => studio.hand(hand)}
          >
            <span className={`swatch ${hand}`} />
            {hand === "left" ? "Left" : "Right"}
          </button>
        ))}
      </div>
    </div>
  );
}
function App() {
  useSyncExternalStore(studio.subscribe, studio.snapshot);
  const [deviceOpen, setDeviceOpen] = useState(true),
    [showKeys, setShowKeys] = useState(false),
    [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const fullscreen = usePianoFullscreen(() => {
    if (!studio.transport.playing && !busy) void startPlayback();
  });
  const s = studio.settings,
    p = studio.practice,
    playing = studio.transport.playing,
    gate = p.gate,
    waiting =
      s.mode === "wait" &&
      playing &&
      !!gate &&
      Math.abs(gate.start - studio.position) < 0.002;
  const collection = collectionForSong(studio.song.id);
  const collectionSongs = studio.songs.filter(
    (song) => collectionForSong(song.id).id === collection.id,
  );
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
    };
    const hidden = () => {
      if (document.hidden && studio.transport.playing) studio.pause();
    };
    const save = () => studio.save();
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
    : studio.notice === "That’s it. Follow the next notes." ||
        studio.notice ===
          "Passage complete. Review your notes below, or restart."
      ? ""
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
  const selectSong = (song: Song | undefined) => {
    if (!song) return;
    studio.save();
    studio.load(song);
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
        <a className="brand" href="./" aria-label="BearPaws home">
          <img
            className="brand-mark"
            src={`${import.meta.env.BASE_URL}bearpaws.svg?v=3`}
            alt=""
            width="40"
            height="40"
          />
          BearPaws
        </a>
        <span className="eyebrow">A little practice. Every day.</span>
        <button
          className="device"
          aria-expanded={deviceOpen}
          onClick={() => setDeviceOpen(!deviceOpen)}
        >
          <span
            className={`dot ${studio.midi.status === "connected" ? "connected" : ""}`}
          />
          {studio.midi.status === "connected"
            ? "Piano connected"
            : "Connect your piano"}
          <span aria-hidden="true">⌄</span>
        </button>
      </header>
      {deviceOpen && (
        <section className="connection" aria-label="Piano connection">
          <div>
            <strong>
              {studio.midi.status === "connected"
                ? "Your piano is ready"
                : "Make room for music"}
            </strong>
            <p role="status">{studio.midi.message}</p>
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
            onImport={() => file.current?.click()}
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
            Your songs stay here.
            <br />
            No uploads. No account.
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
                ) : isBuiltInSong(studio.song.id) ? (
                  "An original beginning · Chords, changes & a simple melody"
                ) : (
                  `${studio.song.tracks.filter((t) => t.count).length} note tracks · ${studio.song.tempos.length || 1} tempo events · Local MIDI`
                )}
              </p>
            </div>
            <div className="song-tools">
              <span className="chip">Saved on this browser</span>
              {isBuiltInSong(studio.song.id) && (
                <a
                  className="song-midi-download"
                  href={`${import.meta.env.BASE_URL}midi/${studio.song.id}.mid`}
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
          <FingerGuide song={studio.song} left={s.left} right={s.right} />
          <div className={`workspace ${s.mode === "wait" ? "guided" : ""}`}>
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
                <PracticeControls />
                <div
                  className="transport-buttons"
                  role="group"
                  aria-label="Playback"
                >
                  <button
                    className="square"
                    aria-label="Restart passage"
                    title="Restart passage"
                    onClick={() =>
                      studio.seek(studio.loopEnabled ? studio.loopStart : 0)
                    }
                  >
                    ↺
                  </button>
                  <button
                    className="primary play"
                    disabled={busy}
                    title={playing ? "Pause (Space)" : "Play (Space)"}
                    aria-keyshortcuts="Space"
                    onClick={() => void toggle()}
                  >
                    {busy ? "Loading piano…" : playing ? "Ⅱ Pause" : "▷ Play"}
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
                <label className="speed">
                  Speed
                  <input
                    aria-label="Playback speed"
                    type="range"
                    min="25"
                    max="150"
                    step="5"
                    value={s.speed * 100}
                    onChange={(e) => studio.speed(Number(e.target.value) / 100)}
                  />
                  <output>{Math.round(s.speed * 100)}%</output>
                </label>
                <span className="time">
                  {stamp(studio.position)} / {stamp(studio.song.duration)}
                </span>
                <PianoSoundControls
                  ambience={s.ambience}
                  onChange={(ambience) => studio.sound(ambience)}
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
              <SheetTimeline
                song={studio.song}
                position={studio.position}
                mode={s.mode}
                hit={p.hit}
                selectedNotes={studio.notes}
                from={p.from}
                onSeek={(position) => studio.seek(position)}
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
            {s.mode === "wait" && (
              <aside className="coach">
                <div className="kicker">Let’s play together</div>
                <h2>
                  {waiting ? "Take your time." : "Find your first notes."}
                </h2>
                <p>
                  {studio.song.lesson
                    ? "Play the highlighted keys with the suggested fingers."
                    : "Play the highlighted keys."}{" "}
                  Release repeated notes before playing them again.
                </p>
                <div className="chord">
                  {[
                    ...new Map(
                      (gate?.notes || []).map((n) => [
                        `${n.track}:${n.pitch}`,
                        n,
                      ]),
                    ).values(),
                  ].map((note) => {
                    const hand =
                      studio.song.tracks.find((t) => t.id === note.track)
                        ?.hand ?? "off";
                    const finger = suggestedFinger(note, hand);
                    return (
                      <span
                        className={`finger-note ${hand} ${studio.input.down.has(note.pitch) ? "held" : ""}`}
                        key={`${note.track}:${note.pitch}`}
                      >
                        <small>{hand === "left" ? "Left" : "Right"}</small>
                        <strong>{noteName(note.pitch)}</strong>
                        {finger && (
                          <small>
                            {finger} · {fingerNames[finger]}
                          </small>
                        )}
                      </span>
                    );
                  })}
                </div>
                <p className="small">
                  {waiting
                    ? "Hold all highlighted keys to move on."
                    : "Next notes in your selected hands."}
                </p>
                <button
                  disabled={studio.audio.loading}
                  onClick={() => void studio.preview()}
                >
                  Hear next notes
                </button>
                <div className="coach-steps">
                  <div>
                    <b>1</b> Find the notes
                  </div>
                  <div>
                    <b>2</b> Play the changes
                  </div>
                  <div>
                    <b>3</b> Try Rhythm when ready
                  </div>
                </div>
              </aside>
            )}
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
                onChange={(e) => {
                  s.names = e.target.checked;
                  studio.persist();
                  studio.emit();
                }}
              />{" "}
              Note names
            </label>
            <span className="pedal">
              Pedal <b>{studio.input.sustain ? "down" : "up"}</b> · Velocity{" "}
              <b>{studio.lastVelocity || "—"}</b>
            </span>
          </div>
          <section className="lower-grid">
            <details className="panel" open>
              <summary>
                Make it yours <span>Tracks & passage</span>
              </summary>
              <div className="assignments">
                {studio.song.tracks
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
                Choose hands explicitly. Track names are only suggestions. A
                single track can be assigned to one hand.
              </p>
              <div className="loop-fields">
                <label>
                  From{" "}
                  <LoopBoundInput
                    key={studio.song.id}
                    label="Loop start seconds"
                    value={studio.loopStart}
                    min={0}
                    max={studio.loopEnd - 0.2}
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
                    key={studio.song.id}
                    label="Loop end seconds"
                    value={studio.loopEnd}
                    min={studio.loopStart + 0.2}
                    max={studio.song.duration}
                    onCommit={(end) => studio.bounds(studio.loopStart, end)}
                  />
                  <span>s</span>
                </label>
                <button
                  title="Set loop end to current position"
                  onClick={() =>
                    studio.bounds(studio.loopStart, studio.position)
                  }
                >
                  Set B
                </button>
              </div>
              {studio.song.warnings.map((w) => (
                <p className="small" key={w}>
                  {w}
                </p>
              ))}
              {!isBuiltInSong(studio.song.id) && (
                <button
                  className="text-button"
                  onClick={() => void studio.remove()}
                >
                  Remove this local song
                </button>
              )}
            </details>
            <section className="panel feedback" aria-label="Practice review">
              <div className="panel-heading">
                A little better each time <span>Practice review</span>
              </div>
              <div className="stats">
                <div>
                  <strong>{p.hit.size}</strong>
                  <span>Matched</span>
                </div>
                <div>
                  <strong>{stats.missed}</strong>
                  <span>Missed</span>
                </div>
                <div>
                  <strong>
                    {stats.timingCount
                      ? Math.round(
                          (stats.timingAbsTotal / stats.timingCount) * 1000,
                        ) + " ms"
                      : "—"}
                  </strong>
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
                  {misses.slice(0, 6).map((m, i) => (
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
                {stats.wrong} wrong presses · {studio.progress.attempts} starts
                saved · Best matched {studio.progress.best}%
                <span>Skipped notes are excluded after seeking.</span>
              </div>
            </section>
          </section>
          <details
            className="keyboard-help"
            onToggle={(e) => setShowKeys(e.currentTarget.open)}
          >
            <summary>
              Try the on-screen keys <span>or use your computer keyboard</span>
            </summary>
            <p>
              Left hand: Z X C V B N M · Right hand: A W S E D F T G Y H U J K.
              You can also click the piano keys. These are practice inputs; your
              USB piano supplies its own live sound. A teal dot marks sound held
              by the pedal after key release.
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
          <footer>
            Practice stays on this browser.{" "}
            <span>USB MIDI · Desktop Chrome / Edge · HTTPS required</span>
            {" · "}
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
createRoot(document.getElementById("root")!).render(<App />);
