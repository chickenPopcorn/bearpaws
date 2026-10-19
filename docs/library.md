# The song library

[← Back to the README](../README.md)

The songs live in the public Supabase bucket `library`, not in this repository.
The app loads them after sign-in:

- `index.json` lists the songs in order, with each one's title, collection
  (`classes`, `songs` or `pops`) and file names. The app loads only `classes`,
  George Bear’s Classes; the bucket also keeps the other two collections. A
  `classes` song may name its `book`: `recital-3` (the default) or `lesson-3`.
  Browsers check the index on every load; it is cached for 60 seconds.
- `songs/<id>.<hash>.json` is each song in the app's format: notes, tracks,
  tempo, suggested fingering and lesson text, and for Recital Book 3 the
  teacher duet (`duet`: its notes, and how many octaves the student part moves
  with it).
- `songs/<id>.<hash>.mid` is each song's MIDI file, for its Download button.

Each file is named after its content hash and cached for a year, so a repeat
visit downloads only `index.json`; a changed song gets a new name.

## Changing the library

To change the library, run `npm run library:pull`, edit `./library` (ignored by
git), then run `npm run library:push`. To add a song, put its MIDI file at
`library/songs/<id>.mid` and add an entry to `library/index.json` with its `id`,
`title`, `collection: "classes"`, an optional `book`, `song: "songs/<id>.json"`
and `midi: "songs/<id>.mid"`; push converts the MIDI into the song file. Each
song file records the hash of the MIDI file it was built from (`sourceMidi`),
and push refuses a MIDI file that a song file was not built from. `./library`
uses plain names; push adds the hashes. Push checks every song (and the 5 MiB
file limit) before it uploads anything, uploads the index last, and removes a
file only 24 hours after the index stops listing it, since a browser may still
be loading it from an earlier index (`retired.json` in the bucket records when
each file left). Uploading needs the project's secret key, in
`SUPABASE_SECRET_KEY`, or a Supabase account token in `MUSIC_API_KEY` to look it
up. The app itself only reads the bucket. A copy of three songs in
`tests/fixtures/` serves the tests.

## MIDI file support

`npm run library:push` converts library MIDI files with the app's parser. Standard MIDI formats **0 and 1** with ticks-per-beat division are supported, including tempo changes across tracks, FIFO pairing of overlapping notes, velocity-zero releases, and channel-wide CC64 sustain. Converted notes keep physical release and sound end separately. Format 2 and SMPTE division produce actionable unsupported-file errors. MIDI files are limited to 10 MB, 256 declared tracks (including empty tracks), 50,000 positive-velocity note attacks, and 500,000 MIDI events. A bounded byte scanner checks both event budgets before the full MIDI parser allocates event objects. Missing note-offs are closed at the track boundary with a warning. Track names do not establish hand assignment; normalized display names are limited to 160 characters. Playback does not reproduce General MIDI instruments, effects, or drum kits.
