import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { Mode } from "./engine";
import {
  noteName,
  suggestedFinger,
  type Finger,
  type Note,
  type Song,
} from "./song";
import {
  buildScore,
  isNotePlayed,
  pitchPosition,
  rhythmForBeats,
  scoreTimeAtX,
  scoreViewport,
  type ScoreNote,
} from "./notation";

interface SheetTimelineProps {
  song: Song;
  position: number;
  mode: Mode;
  hit: ReadonlySet<string>;
  selectedNotes: Note[];
  from?: number;
  onSeek?: (seconds: number) => void;
}

interface ScoreViewport {
  first: number;
  last: number;
  viewWidth: number;
  measureWidth: number;
  offset: number;
}

type StaffHand = "left" | "right";
interface DrawNote {
  score: ScoreNote;
  hand: StaffHand;
  x: number;
  stemX: number;
  labelX: number;
  y: number;
  up: boolean;
  accidental: string;
  finger?: Finger;
  label: string;
  labelY: number;
}

const NoteGlyph = memo(function NoteGlyph({
  item,
  enabled,
  played,
  past,
  active,
}: {
  item: DrawNote;
  enabled: boolean;
  played: boolean;
  past: boolean;
  active: boolean;
}) {
  const {
    score,
    hand,
    x,
    stemX,
    labelX,
    y,
    up,
    accidental,
    finger,
    label,
    labelY,
  } = item;
  const { note, rhythm } = score;
  const top = hand === "right" ? 64 : 172;
  const bottom = top + 40;
  const ledger: number[] = [];
  for (let line = top - 10; line >= y; line -= 10) ledger.push(line);
  for (let line = bottom + 10; line <= y; line += 10) ledger.push(line);
  const stemEnd = y + (up ? -30 : 30);
  const direction = up ? 1 : -1;
  return (
    <g
      className={`sheet-note sheet-note-${hand}${active ? " is-active" : ""}`}
      opacity={!enabled || played || past ? 0.5 : 1}
      data-note-id={note.id}
      data-played={played}
      data-past={past}
      data-enabled={enabled}
    >
      <title>{`${noteName(note.pitch)}${finger ? `, finger ${finger}` : ""}${played ? ", played" : past ? ", earlier in score" : ""}${!enabled ? ", hand hidden" : ""}`}</title>
      {active && (
        <ellipse className="sheet-note-halo" cx={x} cy={y} rx={13} ry={10} />
      )}
      {ledger.map((line) => (
        <line
          key={line}
          x1={x - 10}
          x2={x + 10}
          y1={line}
          y2={line}
          stroke="currentColor"
          strokeWidth={1}
        />
      ))}
      {accidental && (
        <text
          className="sheet-accidental"
          x={x - 17}
          y={y}
          textAnchor="middle"
          fontSize={40}
        >
          {accidental === "♯" ? "\uE262" : "\uE261"}
        </text>
      )}
      <ellipse
        cx={x}
        cy={y}
        rx={rhythm.stem ? 6.4 : 7.5}
        ry={4.4}
        transform={`rotate(-18 ${x} ${y})`}
        fill={rhythm.filled ? "currentColor" : "var(--sheet-paper)"}
        stroke="currentColor"
        strokeWidth={rhythm.filled ? 1 : 1.7}
      />
      {rhythm.stem && (
        <line
          x1={stemX}
          x2={stemX}
          y1={y}
          y2={stemEnd}
          stroke="currentColor"
          strokeWidth={1.4}
        />
      )}
      {Array.from({ length: rhythm.flags }, (_, flag) => {
        const start = stemEnd + direction * flag * 6;
        return (
          <path
            key={flag}
            d={`M ${stemX} ${start} q ${direction * 13} ${direction * 6} ${direction * 7} ${direction * 18} q ${direction * 1} ${direction * -7} ${direction * -7} ${direction * -10}`}
            fill="currentColor"
          />
        );
      })}
      {rhythm.dotted && (
        <circle
          cx={x + 12}
          cy={y % 10 === 4 ? y - 4 : y}
          r={2}
          fill="currentColor"
        />
      )}
      {note.staccato && (
        <circle cx={x} cy={y + (up ? 12 : -12)} r={1.7} fill="currentColor" />
      )}
      {label && (
        <text
          className="sheet-note-label"
          x={labelX}
          y={labelY}
          textAnchor="middle"
        >
          {label}
        </text>
      )}
    </g>
  );
});

function Rest({ x, y, beats }: { x: number; y: number; beats: number }) {
  const rhythm = rhythmForBeats(beats);
  return (
    <g
      className="sheet-rest"
      transform={`translate(${x} ${y})`}
      aria-label={`${beats}-beat rest`}
    >
      {rhythm.baseBeats >= 2 ? (
        <rect
          x={-6}
          y={rhythm.baseBeats >= 4 ? -10 : -5}
          width={12}
          height={5}
          fill="currentColor"
        />
      ) : rhythm.baseBeats >= 1 ? (
        <path
          d="M -3 -15 L 5 -6 L -1 1 L 4 7 Q -6 3 -2 13 Q -10 6 -4 2 L -7 -3 L 0 -9 Z"
          fill="currentColor"
        />
      ) : (
        <g stroke="currentColor" strokeWidth={1.8} fill="currentColor">
          <path d="M 5 -7 L -2 13" fill="none" />
          <circle cx={-1} cy={-7} r={3} />
          <path d="M -1 -7 Q 5 -2 5 -7" fill="none" />
        </g>
      )}
      {rhythm.dotted && <circle cx={11} cy={-2} r={1.8} fill="currentColor" />}
    </g>
  );
}

/** A compact moving score. Layout work is cached; playback only changes states. */
export function SheetTimeline({
  song,
  position,
  mode,
  hit,
  selectedNotes,
  from = 0,
  onSeek,
}: SheetTimelineProps) {
  const svg = useRef<SVGSVGElement>(null);
  const clipId = useId();
  const [size, setSize] = useState({ width: 960, height: 210 });
  const [frozen, setFrozen] = useState<ScoreViewport | null>(null);
  const gesture = useRef<{
    pointerId: number;
    viewport: ScoreViewport;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  useEffect(() => {
    gesture.current = null;
    setFrozen(null);
  }, [song.id]);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const score = useMemo(
    () => buildScore(song),
    [
      song,
      song.notes,
      song.tempos,
      song.ppq,
      song.beatsPerBar,
      song.timeSignatures,
      song.leadInBeats,
    ],
  );
  const selected = useMemo(
    () => new Set(selectedNotes.map((note) => note.id)),
    [selectedNotes],
  );
  const beat = score.clock.at(position) - score.leadInBeats;
  const currentMeasure = Math.max(
    0,
    Math.min(score.measureCount - 1, score.meter.at(beat).measure),
  );
  const currentBar = score.meter.measureAt(currentMeasure);
  // Track assignment can change in place, so use its small signature as a cache key.
  const handSignature = song.tracks
    .map((track) => `${track.id}:${track.hand}`)
    .join(",");
  // Keep the staff scale steady as notes enter and leave the viewport.
  const bounds = useMemo(() => {
    const hands = new Map(song.tracks.map((track) => [track.id, track.hand]));
    let minimum = 0;
    // The third bass-chord label has baseline 264; retain its descenders too.
    let maximum = 270;
    for (const note of song.notes) {
      const hand = hands.get(note.track);
      if (hand !== "left" && hand !== "right") continue;
      const y = pitchPosition(note.pitch, hand).y;
      minimum = Math.min(minimum, y - 40);
      maximum = Math.max(maximum, y + 42);
    }
    return { minimum, height: maximum - minimum };
  }, [song.notes, handSignature]);
  const following = scoreViewport(
    beat,
    score.measureCount,
    score.meter,
    Math.max(1, Math.min(6, Math.floor(size.width / 280))),
    // Match the real SVG aspect ratio so the score fills its width without
    // stretching the notes or leaving empty margins beside the staffs.
    (size.width * bounds.height) / size.height,
  );
  const prefix = 88;
  const viewport: ScoreViewport = frozen || following;
  const window = viewport;
  const { viewWidth, measureWidth } = viewport;
  const noteX = (measure: number, offset: number) =>
    prefix +
    (measure - window.first) * measureWidth +
    24 +
    (offset / score.meter.measureAt(measure).length) * measureWidth;
  const layout = useMemo(() => {
    const hands = new Map(song.tracks.map((track) => [track.id, track.hand]));
    const drawn: DrawNote[] = [];
    const rests: { x: number; y: number; beats: number; key: string }[] = [];
    let condensed = false;
    for (let measure = window.first; measure < window.last; measure++) {
      const barLength = score.meter.measureAt(measure).length;
      const bar = (score.measures.get(measure) || []).filter((item) => {
        const hand = hands.get(item.note.track);
        return hand === "left" || hand === "right";
      });
      // Bound even a malicious/dense MIDI with thousands of notes on one beat.
      const limit = Math.min(
        80,
        Math.floor(240 / (window.last - window.first)),
      );
      condensed ||= bar.length > limit;
      const visible =
        bar.length <= limit
          ? bar
          : Array.from(
              { length: limit },
              (_, i) => bar[Math.floor((i * bar.length) / limit)],
            );
      const accidentalState = new Map<string, boolean>();
      const chordRows = new Map<string, number>();
      const chords = new Map<
        string,
        { sum: number; count: number; previousY?: number; displaced?: boolean }
      >();
      for (const item of visible) {
        const hand = hands.get(item.note.track) as StaffHand;
        const key = `${hand}:${item.offset.toFixed(4)}`;
        const chord = chords.get(key) || { sum: 0, count: 0 };
        chord.sum += pitchPosition(item.note.pitch, hand).y;
        chord.count++;
        chords.set(key, chord);
      }
      for (const item of visible) {
        const hand = hands.get(item.note.track) as StaffHand;
        const pitch = pitchPosition(item.note.pitch, hand);
        const accidentalKey = `${hand}:${pitch.step}`;
        const oldSharp = accidentalState.get(accidentalKey) || false;
        const accidental = pitch.sharp ? "♯" : oldSharp ? "♮" : "";
        accidentalState.set(accidentalKey, pitch.sharp);
        const chordKey = `${hand}:${item.offset.toFixed(4)}`;
        const chord = chords.get(chordKey)!;
        const up = chord.sum / chord.count >= (hand === "right" ? 84 : 192);
        const distance = Math.abs(pitch.y - (chord.previousY ?? Infinity));
        const displaced =
          distance > 0 && distance <= 5.01 ? !chord.displaced : false;
        chord.previousY = pitch.y;
        chord.displaced = displaced;
        const x = noteX(measure, item.offset);
        const row = chordRows.get(chordKey) || 0;
        chordRows.set(chordKey, row + 1);
        const finger = suggestedFinger(item.note, hand);
        drawn.push({
          score: item,
          hand,
          x: x + (displaced ? (up ? 11 : -11) : 0),
          stemX: x + (up ? 5.5 : -5.5),
          labelX: x,
          y: pitch.y,
          up,
          accidental,
          finger,
          label:
            row < 3
              ? `${noteName(item.note.pitch)}${finger ? ` · ${finger}` : ""}`
              : "",
          labelY: (hand === "right" ? 134 : 242) + row * 11,
        });
      }
      // Built-in lessons retain printed values, including rests and articulation.
      // Imported performance MIDI does not supply reliable rest notation.
      if (song.lesson) {
        for (const hand of ["right", "left"] as const) {
          const intervals = bar
            .filter((item) => hands.get(item.note.track) === hand)
            .map((item) => [
              item.offset,
              Math.min(barLength, item.offset + item.duration),
            ])
            .sort((a, b) => a[0] - b[0]);
          const gaps: [number, number][] = [];
          let end = 0;
          for (const interval of intervals) {
            if (interval[0] > end + 0.01) gaps.push([end, interval[0] - end]);
            end = Math.max(end, interval[1]);
          }
          if (end < barLength - 0.01) gaps.push([end, barLength - end]);
          for (const [start, beats] of gaps) {
            rests.push({
              x:
                beats === barLength
                  ? prefix + (measure - window.first + 0.5) * measureWidth
                  : noteX(measure, start),
              y: hand === "right" ? 84 : 192,
              beats,
              key: `${measure}-${hand}-${start}`,
            });
          }
        }
      }
    }
    return {
      notes: drawn,
      rests,
      condensed,
    };
  }, [
    score,
    window.first,
    window.last,
    measureWidth,
    handSignature,
    song.lesson,
  ]);

  const beatInMeasure = Math.max(0, beat - currentBar.start);
  const marker = Math.max(
    prefix,
    Math.min(
      viewWidth - 15,
      noteX(currentMeasure, Math.min(currentBar.length, beatInMeasure)) -
        viewport.offset,
    ),
  );
  const countIn = beat < -0.001;
  const bars = Array.from(
    { length: window.last - window.first },
    (_, index) => window.first + index,
  );
  const seekPointer = (
    event: PointerEvent<SVGSVGElement>,
    axis: ScoreViewport,
    exactNote = false,
  ) => {
    if (!onSeek) return;
    if (exactNote) {
      const target = event.target as Element;
      const noteId = target
        .closest?.("[data-note-id]")
        ?.getAttribute("data-note-id");
      const note = layout.notes.find((item) => item.score.note.id === noteId)
        ?.score.note;
      if (note) {
        onSeek(Math.max(0, Math.min(song.duration, note.start)));
        return;
      }
    }
    const svg = event.currentTarget;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    // The clef/count-in area also provides a way back to the very beginning.
    const time =
      axis.first === 0 && local.x <= prefix
        ? 0
        : scoreTimeAtX(
            local.x,
            { ...axis, beatsPerBar: score.meter },
            score.clock,
            score.leadInBeats,
            song.duration,
          );
    onSeek(time);
  };
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!onSeek || event.button !== 0 || gesture.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    gesture.current = {
      pointerId: event.pointerId,
      viewport,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    setFrozen(viewport);
    event.currentTarget.setPointerCapture(event.pointerId);
    seekPointer(event, viewport, true);
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    current.moved ||=
      Math.hypot(
        event.clientX - current.startX,
        event.clientY - current.startY,
      ) > 3;
    if (current.moved) seekPointer(event, current.viewport);
  };
  const finishPointer = (
    event: PointerEvent<SVGSVGElement>,
    cancelled = false,
  ) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!cancelled && current.moved) seekPointer(event, current.viewport);
    gesture.current = null;
    setFrozen(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const seekKeyboard = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!onSeek) return;
    let time: number;
    if (event.key === "Home") time = 0;
    else if (event.key === "End") time = song.duration;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      const next = event.shiftKey
        ? score.meter.beatAt(score.meter.coordinate(beat) + 1)
        : beat + currentBar.beatUnit;
      time = score.clock.time(next + score.leadInBeats);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      const previous = event.shiftKey
        ? score.meter.beatAt(score.meter.coordinate(beat) - 1)
        : beat - currentBar.beatUnit;
      time = score.clock.time(previous + score.leadInBeats);
    } else return;
    event.preventDefault();
    event.stopPropagation();
    onSeek(Math.max(0, Math.min(song.duration, time)));
  };
  return (
    <section className="sheet-timeline" aria-label="Sheet music timeline">
      <div className="sheet-timeline-header">
        <strong>Sheet music</strong>
        <span className="sheet-timeline-progress">
          {countIn
            ? "Count in"
            : `Bar ${currentMeasure + 1} of ${score.measureCount} · Beat ${Math.min(currentBar.numerator, Math.floor(beatInMeasure / currentBar.beatUnit) + 1)}`}
        </span>
        <span className="sheet-timeline-legend">
          {onSeek && "Click or drag to seek · "}Played notes fade to 50%
        </span>
      </div>
      <svg
        ref={svg}
        className={`sheet-timeline-svg${onSeek ? " is-seekable" : ""}${frozen ? " is-seeking" : ""}`}
        viewBox={`0 ${bounds.minimum} ${viewWidth} ${bounds.height}`}
        role={onSeek ? "slider" : "img"}
        tabIndex={onSeek ? 0 : undefined}
        aria-label={
          onSeek
            ? "Song position on sheet music"
            : `Piano score, bars ${window.first + 1} to ${window.last}. Played and past notes fade to half opacity.`
        }
        aria-valuemin={onSeek ? 0 : undefined}
        aria-valuemax={onSeek ? song.duration : undefined}
        aria-valuenow={onSeek ? position : undefined}
        aria-valuetext={
          onSeek
            ? `${position.toFixed(1)} seconds, bar ${currentMeasure + 1} of ${score.measureCount}`
            : undefined
        }
        aria-orientation={onSeek ? "horizontal" : undefined}
        style={onSeek ? { touchAction: "none" } : undefined}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={(event) => finishPointer(event)}
        onPointerCancel={(event) => finishPointer(event, true)}
        onLostPointerCapture={(event) => finishPointer(event, true)}
        onKeyDown={seekKeyboard}
      >
        <defs>
          <clipPath id={clipId}>
            <rect
              x={prefix}
              y={bounds.minimum}
              width={viewWidth - prefix - 15}
              height={bounds.height}
            />
          </clipPath>
        </defs>
        <g className="sheet-staff-line" fill="none">
          {[64, 74, 84, 94, 104, 172, 182, 192, 202, 212].map((y) => (
            <line key={y} x1={30} x2={viewWidth - 15} y1={y} y2={y} />
          ))}
          <path d="M 27 64 Q 17 74 23 108 Q 27 132 18 138 Q 27 144 23 168 Q 17 202 27 212" />
        </g>
        <text className="sheet-clef" x={36} y={94} fontSize={40}>
          {"\uE050"}
        </text>
        <text className="sheet-clef" x={36} y={182} fontSize={40}>
          {"\uE062"}
        </text>
        <g className="sheet-time-signature" textAnchor="middle" fontSize={40}>
          <text x={74} y={74}>
            {String(currentBar.numerator).replace(/\d/g, (digit) =>
              String.fromCodePoint(0xe080 + Number(digit)),
            )}
          </text>
          <text x={74} y={94}>
            {String(currentBar.denominator).replace(/\d/g, (digit) =>
              String.fromCodePoint(0xe080 + Number(digit)),
            )}
          </text>
          <text x={74} y={182}>
            {String(currentBar.numerator).replace(/\d/g, (digit) =>
              String.fromCodePoint(0xe080 + Number(digit)),
            )}
          </text>
          <text x={74} y={202}>
            {String(currentBar.denominator).replace(/\d/g, (digit) =>
              String.fromCodePoint(0xe080 + Number(digit)),
            )}
          </text>
        </g>
        <g clipPath={`url(#${clipId})`}>
          <g
            className="sheet-score-motion"
            transform={`translate(${-viewport.offset} 0)`}
          >
            {bars.map((measure) => {
              const left = prefix + (measure - window.first) * measureWidth;
              const bar = score.meter.measureAt(measure);
              return (
                <g key={measure}>
                  <text
                    className={`sheet-bar-number${measure === currentMeasure ? " is-current" : ""}`}
                    x={left + 13}
                    y={33}
                  >
                    {measure + 1}
                  </text>
                  <line
                    className="sheet-bar-line"
                    x1={left + measureWidth}
                    x2={left + measureWidth}
                    y1={64}
                    y2={212}
                  />
                  {Array.from(
                    {
                      length: Math.min(
                        16,
                        Math.ceil(bar.length / bar.beatUnit),
                      ),
                    },
                    (_, b) => (
                      <g key={b}>
                        <line
                          className="sheet-beat-tick"
                          x1={noteX(measure, b * bar.beatUnit)}
                          x2={noteX(measure, b * bar.beatUnit)}
                          y1={43}
                          y2={48}
                        />
                        <text
                          className="sheet-beat-number"
                          x={noteX(measure, b * bar.beatUnit)}
                          y={17}
                          textAnchor="middle"
                        >
                          {b + 1}
                        </text>
                      </g>
                    ),
                  )}
                </g>
              );
            })}
            {layout.rests.map((rest) => (
              <Rest {...rest} key={rest.key} />
            ))}
            {layout.notes.map((item) => {
              const enabled = selected.has(item.score.note.id);
              const played =
                enabled &&
                isNotePlayed(item.score.note, mode, hit, position, from);
              const past = position > item.score.note.start + 0.001;
              const active =
                enabled &&
                !played &&
                !past &&
                position >= item.score.note.start - 0.002 &&
                position < item.score.note.end;
              return (
                <NoteGlyph
                  key={item.score.note.id}
                  item={item}
                  enabled={enabled}
                  played={played}
                  past={past}
                  active={active}
                />
              );
            })}
          </g>
          <line
            className="sheet-playhead"
            x1={marker}
            x2={marker}
            y1={43}
            y2={222}
          />
          <path
            className="sheet-playhead-tip"
            d={`M ${marker - 4} 40 L ${marker + 4} 40 L ${marker} 46 Z`}
          />
        </g>
      </svg>
      {layout.condensed && (
        <span className="sheet-density-note">
          Dense passage · condensed preview
        </span>
      )}
    </section>
  );
}
