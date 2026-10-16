import { writeMidi } from "midi-file";
import { mkdirSync, writeFileSync } from "node:fs";
const right = [],
  left = [];
function add(events, pitch, start, duration) {
  events.push(
    { at: start, type: "noteOn", channel: 0, noteNumber: pitch, velocity: 90 },
    {
      at: start + duration,
      type: "noteOff",
      channel: 0,
      noteNumber: pitch,
      velocity: 0,
    },
  );
}
[
  [60, 64, 67],
  [60, 65, 69],
  [59, 62, 67],
  [60, 64, 67],
].forEach((chord, i) => {
  chord.forEach((p) => add(right, p, 640 + i * 1280, 608));
  add(left, [48, 53, 55, 48][i], 640 + i * 1280, 1088);
});
[60, 60, 62, 64, 65, 64, 62, 60].forEach((p, i) =>
  add(right, p, 5760 + i * 480, 352),
);
[48, 53, 55, 48].forEach((p, i) => add(left, p, 5760 + i * 960, 768));
function track(events, name, channel) {
  let last = 0;
  return [
    { deltaTime: 0, type: "trackName", text: name },
    { deltaTime: 0, type: "setTempo", microsecondsPerBeat: 750000 },
    ...events
      .sort(
        (a, b) =>
          a.at - b.at ||
          Number(a.type === "noteOn") - Number(b.type === "noteOn"),
      )
      .map(({ at, ...event }) => {
        const deltaTime = at - last;
        last = at;
        return { ...event, channel, deltaTime };
      }),
    { deltaTime: 320, type: "endOfTrack" },
  ];
}
mkdirSync("public/examples", { recursive: true });
writeFileSync(
  "public/examples/first-steps.mid",
  new Uint8Array(
    writeMidi({
      header: { format: 1, numTracks: 2, ticksPerBeat: 480 },
      tracks: [
        track(left, "Left - steady foundations", 0),
        track(right, "Right - chords and melody", 1),
      ],
    }),
  ),
);
