# MIDI and USB pianos

[← Back to the README](../README.md)

Desktop Chrome or Edge is the initial USB MIDI target. Web MIDI requires a
secure context: localhost is allowed for development; hosted use requires HTTPS
and a permissions policy that allows MIDI.

## Connect your piano

Click **Connect your piano** in the header to grant MIDI permission the first time; it changes to **Piano connected**. On later visits, saved browser permission automatically connects the first available MIDI input. When more than one input is available, a menu beside it chooses one. If the chosen input is unplugged, clicking Connect your piano picks any available input. Plugging the selected device back in rebinds it; reconnecting does not resume practice automatically. Browsers without MIDI permission queries keep the Connect button.

Your physical piano supplies live piano sound. The app never echoes incoming USB notes. Key-down highlights are separate from pedal-sustained sound (teal dots). Switching inputs or disconnecting clears key/pedal state and pauses Wait/Rhythm; Listen continues. Seek/restart and loop transitions clear transient input and cancel scheduled playback.

## Play the app's sound on a USB piano

In desktop Chrome or Edge, connect a piano that exposes a MIDI **output** as well
as an input. When it connects, all of the app's sound goes to the piano instead
of the laptop: Listen's playback of your part, the teacher duet, keys played on
screen or with computer shortcuts, and the song's sustain pedal (CC64). Only
the metronome's click stays on the laptop (see below). The app
picks the output named like the piano's input, or else the only output there
is; nothing needs choosing. **Sound** in the header shows the choice. Choose
**Laptop** there to return all sound to the browser for the rest of the visit,
or another output. The laptop plays nothing while a MIDI output is in use, and
loads no piano samples for the notes it sends. A piano with no MIDI output keeps
the laptop's sound. Laptop mute does not mute MIDI output, but it mutes the
metronome.

Everything goes out on the same MIDI channel as the latest key played on the
piano (channel 1 until the first keypress). The metronome's click is never
sent: on a piano with one channel it would sound as a piano note and ring
with the song's pedal, so it always plays on the laptop. The student's physical keys remain
live on the piano and are never sent back to it. The teacher still waits at each
**Wait for me** gate and resumes when the student plays the requested note. If
the piano's output disconnects or cannot open, playback stops and **Sound** goes
back to Laptop, so the next Play uses the laptop. The piano is chosen again when
it reconnects; choose it under **Sound** to retry sooner.

Keep the piano’s local keyboard sound enabled. The app follows the incoming
piano channel automatically, so no separate multichannel setup is needed.
Disable any MIDI-thru/loopback routing that returns outgoing notes as input. A
repeated note that overlaps the one before it is played again, as written.
Each note ends where its sound ends on the laptop; the pedal adds the piano's
own resonance, and since it shares your channel it also holds notes you play
while it is down. On-screen keys and computer shortcuts sound for as long as
they are held, and come up when the window loses focus. The app sends note-offs
for its own sounding notes and lifts its pedal on pause, seek, loop restart,
song/output changes and closing the studio, and closes an output it stops
using. Notes go out on the 20 ms practice clock: each tick releases the notes
it has passed and strikes the ones it has reached, and a tick that runs late
still plays the notes it passed, for one tick. Hardware latency and piano sound
depend on the device. Test on the physical piano to confirm its channel
settings, tone, timing, pedal and note releases.
