# Workbook games

[← Back to the README](../README.md)

Game ideas for _Music for Little Mozarts, Music Workbook 3_, played on the USB
piano. Each workbook page is a paper task (color, circle, draw a line, or
listen). Each game below turns one kind of paper task into something the child
does with the piano keys, so one game covers many pages.

## Coverage

The exercises are on pages 4–48: **45 pages**. Pages 1–3 are the cover, the
note to the teacher and the table of contents.

| Status                | Pages |
| --------------------- | ----: |
| Page has a game idea  | 45/45 |
| Page seen in a photo  | 45/45 |
| Game built in the app | 45/45 |

By game, in the suggested build order:

| #   | Game              | Pages                                          | Count | Running total |
| --- | ----------------- | ---------------------------------------------- | ----: | ------------: |
| 1   | Crayon Keys       | 7, 9, 11, 14, 36, 37, 38, 42                   |     8 |          8/45 |
| 2   | Color by Note     | 4, 8, 10, 12, 21, 26, 33, 45, 48               |     9 |         17/45 |
| 3   | Interval Hop      | 13, 19, 20, 23, 24, 28, 39, 40, 41, 43, 44, 47 |    12 |         29/45 |
| 4   | Ear Detective     | 17, 18, 22, 25, 27, 46                         |     6 |         35/45 |
| 5   | Together or Apart | 5, 29, 31, 32, 35                              |     5 |         40/45 |
| 6   | Hold It!          | 6, 15, 16                                      |     3 |         43/45 |
| 7   | Note Snap         | 30, 34                                         |     2 |         45/45 |

Games 1 and 2 share one engine (play a note, paint it), so building both first
covers 17 pages. Interval Hop adds the most pages of any single game.

**Built:** all 45 pages, in all seven games. The pages and the note and
interval games are in `src/workbook.ts` (`PaintGame`, `IntervalGame`,
`HopGame`, `ControlKeys`); Hold It! in `src/workbookHold.ts`; Left Hand and
Right Hand in `src/workbookHands.ts`; Ear Detective in `src/workbookEar.ts`;
and the screen in `src/WorkbookScreen.tsx`, `src/WorkbookPicture.tsx` and
`src/workbookKeyboard.ts`. Music Workbook 3 is the last section of the
library.

**Not built yet:**

- Note Snap's reverse round (a letter lights; play it in the page's position).
- E2 after a lesson song, to open its workbook page.
- Stamps sync to the account; today they stay in this browser.
- Workbook time in the practice calendar.
- Full-screen workbook pages.

## Rules for every game

- **Prompts are text on screen.** No voice; a grown-up reads them aloud when
  needed.
- **Mistakes get a hint, not a score.** The key wobbles, a hint appears, and
  the child tries again. Every page ends with the stamp.
- **The piano is the only controller.** No mouse, trackpad or computer
  keyboard during a workbook game: answers, listening, moving between pages and
  starting over all happen on the piano. See [Piano controls](#piano-controls).
  One piano only.
- **Sound:** piano notes use the piano sound (laptop or piano output, as set
  under Sound). Claps, metronome ticks and cheers stay on the laptop.
- **Art:** simple shapes (blobs, stars, flowers), not scans of the book's
  illustrations, drawn in the app's own style (see
  [Look and feel](#look-and-feel)). Keep the book's page numbers, task words and crayon colors so
  the screen and the paper page match.
- **Done stamp:** a finished page gets a date stamp, like the teacher's stamp
  in the book (for example `OCT 15 2026`), shown on the page and in the
  library. It should also count in the practice calendar (not built yet).
- **Use with page N:** each workbook page says which Lesson Book page it goes
  with. After the child plays that lesson song, offer the workbook page.

## Piano controls

The piano is split into three zones. Their MIDI numbers are fixed, so they work
the same on a 49-, 61- or 88-key piano.

| Zone    | Keys           | MIDI           | Use                                                                       |
| ------- | -------------- | -------------- | ------------------------------------------------------------------------- |
| Control | C2, D2, E2, F2 | 36, 38, 40, 41 | Move around the workbook                                                  |
| Play    | C3 to C5       | 48–72          | Every note printed on a workbook page (check each page when transcribing) |
| Answer  | G5, A5, B5, C6 | 79, 81, 83, 84 | Multiple-choice answers                                                   |

The screen's keyboard shows all three zones, with a mark and a word on each
control key. The answer keys stay faded until a question needs them. The app
never counts a control or answer key as a wrong note and plays no sound for
it; the piano itself still sounds it.

**Control keys**

| Key | Press                                                       | Hold 2 seconds       |
| --- | ----------------------------------------------------------- | -------------------- |
| C2  | Listen again (Ear Detective) or show the hint (other games) | —                    |
| D2  | Previous page                                               | Leave the workbook   |
| E2  | Next page; after a song, open its workbook page (not built) | —                    |
| F2  | —                                                           | Start this page over |

- The two actions that lose progress (leave, start over) need a 2-second hold,
  so a bump does not trigger them.
- Not built yet: after a lesson song ends, the screen offers its workbook page
  ("Use with page N") and E2 opens it.
- No sustain pedal control: small feet may not reach it.

**Answer keys** hold the stickers for questions the child cannot answer by
playing: Same or Different, 2/3/4, Skip, LH or RH glove, and the top or bottom
backup on ear pages. Only the keys a question needs get a sticker.

**Playing an answer** stays the main way to answer: painting, hopping, echoing
and holding all use the play zone. On ear pages any play-zone key works for
tapping a rhythm back.

## Look and feel

The games use Paw Pal's existing design system, not a new one. A workbook page
should look like another screen of the practice studio.

**Tokens and type** come from `src/style.css`: the `--text`, `--text-2`,
`--muted`, `--accent`, `--accent-text`, `--line` and `--soft` colors, the
`--space-*` spacing scale, `--radius-sm`/`--radius-md`, and the `--text-*` type
scale. Interface text is Inter; headings and note names use Libre Baskerville
(`--score-font`); notation uses Bravura.

**Parts to reuse**

| Game screen part          | Existing part                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Workbook in the library   | A section after the class books in `SongLibrary`, with `.library-section` and `.song` rows (one row per page)     |
| Page header               | `.song-head`: `.kicker` "Music Workbook 3 · Page 9", `h1` with a `.song-title-initial`, `.chip` "Use with page 9" |
| Keyboard                  | `src/workbookKeyboard.ts`, drawn with `render.ts`'s key helpers: same keys, pressed keys in `--accent`, C labels  |
| Painted keys              | Filled like heard keys in `render.ts`, with the crayon color instead of a hand color                              |
| Letters after two misses  | The note-name labels `render.ts` already draws on keys                                                            |
| Staff cards and areas     | Staff drawing from `src/notation.ts` and `.sheet-*` classes in Bravura                                            |
| Cards, pictures, legends  | `.panel` (white, `--line` border, `--radius-md`)                                                                  |
| Prompt line               | `.roll-caption` heading style, like "Your pace. Your next note."                                                  |
| Hints                     | `--muted` text under the prompt                                                                                   |
| Left or right hand answer | `BearPaw` (teal `#51b3a5` left, lavender `#a086e9` right), not drawn gloves                                       |
| Done stamp                | `.practice-stamp.earned` (amber ring, `bearpaws.svg`, tilted) with the date in `--score-font`                     |
| Celebration               | The calendar's `practice-star-pop` and `practice-spark` animations                                                |
| Big keyboard view         | `usePianoFullscreen` and the `.piano-expanded` layout                                                             |

**New: crayon colors.** The book names real crayon colors, so the child must
see "yellow" as yellow. They are `CRAYONS` in `src/workbook.ts`, since the
canvas keyboard and the SVG picture both paint with them. Two reuse app
colors:

| Crayon | Value     | Note                    |
| ------ | --------- | ----------------------- |
| red    | `#e0705c` |                         |
| orange | `#f0a04b` |                         |
| yellow | `#f2c12e` | Same as the duet yellow |
| green  | `#7cbf6a` |                         |
| blue   | `#5b9be0` |                         |
| purple | `#a086e9` | Same as the right hand  |
| pink   | `#ef8fb5` |                         |
| brown  | `#a87a55` |                         |
| gray   | `#a3a0ad` |                         |

Letters on a painted key use `--text`. Brown is the weakest pair (about 4:1);
check it again when page 4 is built.

**New: control and answer keys.** The control keys (C2–F2) and answer keys
(G5–C6) are drawn as two short key groups at the left and right ends of the
same canvas, a white key's gap from the play zone. Each control key has its
mark and word drawn on it, below the black keys.

## The games

### 1. Crayon Keys

Paper task: color named keys on a drawn keyboard, sometimes also the matching
staff note.

The screen shows the page's keyboard and a crayon. A prompt says "Find BASS
CLEF D" in the crayon's color. The child plays the key; the on-screen key fills
with that color. On pages with a staff (36, 37, 38, 42), the note on the staff
gets the same crayon, so the note and the key connect.

- Wrong octave: the key wobbles and an arrow points up or down ("That is
  TREBLE CLEF D. Go lower.").
- Page 14: color all five keys of Left Hand C Position (bass C–G), in any
  order; the hint counts down the ones left.
- Check: exact MIDI pitch (Middle C = 60, Bass Clef C = 48).
- Letter names stay hidden on the keys, like the book. After two misses on
  the same prompt, the letters appear.

### 2. Color by Note

Paper task: a picture divided into areas, each with a small staff. Color each
area by the note or interval in it.

The picture starts as an outline. A legend shows each note and its crayon. The
crayons go one at a time, in the book's step order: only step 1's note paints
until all its areas are done, then step 2 starts. The child plays a note; every
area that holds that note fills with paint. The page is done when the picture
is full.

- Note pages (4, 8, 10, 12, 21, 48): one note per area. Pages 4 and 48 have
  seven colors (A–G): page 4 reviews Middle C Position, and page 48 is the
  end-of-book challenge.
- Pages 4, 21 and 48 name notes by letter only ("an F"). Such a step can hold
  a note in each clef (F3 and F4); it is done once every one of them is
  played, and "Yes! Now find the other F." sends the child to the next.
- Interval pages (26, 33, 45): each area holds two notes. The areas go one at
  a time, in the book's step order (all the 2nds, then the 3rds), and the one
  to play is outlined. Harmonic intervals must be played together (starting
  within 150 ms), melodic ones left note first, then the right one. When both
  notes are right, the area paints in its interval's crayon by itself and the
  hint names it ("Yes! That is a 3rd: purple."); the child does not name the
  interval here. One note of a harmonic interval alone is half a try, not a
  mistake.

### 3. Interval Hop

Paper task: circle steps, skips, repeats and intervals (2nds–5ths), going up or
down.

A character stands on the on-screen keyboard. A two-note card appears; the
child plays both notes in order. The character hops from key to key: a small
hop for a step or 2nd, a jump for a skip or 3rd, a big leap for a 4th or 5th,
and a bounce in place for a repeat. The card gets a circle in the page's crayon
color for up or down.

- **Hop** (13, 19, 23, 39, 43): built. Pages 19–43 first color note heads by
  letter, as the book asks ("Color each G orange."), like a Color by Note
  letter step. Then the cards go one at a time in the book's step order (all
  going up, then all going down; on page 13 steps, then skips, then repeats),
  outlined. The child plays the card's notes left then right (a repeat is the
  same key twice); the card is circled in its step's crayon, the hint names it
  ("Yes! A 2nd going up: green."), and a paw over the keyboard hops from the
  first key to the second, higher for wider intervals.
- **Find the 2nds** (20, 24, 40, 44): built. The cards go one at a time,
  in order, outlined. The child decides: a card that holds the page's
  interval is played left then right and circled in the page's crayon (and
  the paw hops); any other card is passed over with the Skip sticker on the
  first answer key, G5, and fades. Playing a card without the interval says
  what it is ("That is a 3rd, not a 2nd. Press Skip (G5)."); Skip on a card
  that holds it sends the child back ("Look again: that is a 2nd.").
- **How far?** (41): built. The child plays each card as written (the 4th
  together), then presses the answer key whose sticker says how far apart its
  notes are: G5 is 2, A5 is 3, B5 is 4. The answer is circled under the card,
  as in the book; a wrong one gets "Count each line and space". On the
  computer keyboard L, ; and ' are G5, A5 and B5.
- **Twins** (28, 47): built. Each box's top card, then its bottom card, is
  played left then right; then the child presses G5 (Same) or A5 (Different),
  and the answer is circled under the bottom card. The hint names the
  character the book circles: Beethoven Bear or Mozart Mouse on 28, Haydn
  Hippo or Clara Schumann-Cat on 47. On the computer keyboard L and ; are G5
  and A5.
- Extra round: "Play a 3rd up from E." The child builds the interval.

### 4. Ear Detective

Paper task: the teacher plays or claps; the child circles the example they
heard.

Built. The app is the teacher. C2 (or 1 on the computer keyboard) plays
the example, picked at random from its two options: a rhythm is clapped on
the laptop after a bar of metronome clicks; a melody plays in the piano's
sound, on the piano itself when its output is chosen. Then the child plays
it back:

- **Rhythm** (18, 22): taps on any key. The taps must number as the
  pattern's notes and be spaced like it, at the child's own tempo.
- **Melody** (25, 46): the notes, in order.
- **Staccato or legato** (17, 27): the notes, short or held. Page 17 has no
  notation: five notes of the right or left hand's Middle C Position, up or
  down, and the answer is Nannerl Mouse (staccato) or Haydn Hippo (not).

An echo that matches the example circles it. One that matches the other
option says so. One that matches neither turns on the answer keys: G5 for
the top (Nannerl Mouse on 17), A5 for the bottom (Haydn Hippo). The child
can listen again any number of times.

### 5. Together or Apart

Paper task: circle harmonic intervals, melodic intervals, or examples played
hands together; color the hand that plays.

Built.

- Harmonic and melodic (31, 32): six cards each, read from the pages. Like
  Interval Hop's Find pages, the cards go one at a time: a card the page
  asks for (notes together on 31, apart on 32) is played as written and
  circled; any other is passed over with Skip (G5, or L).
- Hands together (35): six grand staff cards, three with a bass note and
  three with a rest. Both hands' notes played together circle the card; a
  card with one hand resting is skipped.
- Which hand (5, 29): for each example the child presses LH (G5) or RH
  (A5), then plays it. The hand is colored red. On page 29 the slur is
  played legato: each key held until the next goes down (up to 0.12 s
  apart); a gap starts the example again. Once played, the slur is traced.

### 6. Hold It!

Paper task: match notes and rests to their counts; circle staccato notes.

Built. Any key in the play zone plays; the laptop's metronome clicks each
count (the first one accented) at 60 beats a minute, and a bar of blocks,
one per count, fills as the counts pass.

- Notes (6): hold a key for the note's counts and let go, half a count
  early or late at most. Quarter = 1, half = 2, dotted half = 3, whole = 4.
  A done card shows its count ("= 2"), as the book's line would.
- Rests (16): play a note and let go; the rest is counted from there. Play
  the next note when the bar is full (up to 0.4 of a count early or 0.6
  late). Too soon or too late says so, and that key starts a new try.
- Staccato (15): the page's eight notes, four with a staccato dot. Play each
  as written: a dotted note let go within 0.3 s, a plain one held at least
  0.6 s. Staccato notes are circled orange; plain ones fade.

### 7. Note Snap

Paper task: draw lines from letter names to staff notes.

Built. The page's two columns, as printed: letter cards with a dot, and
staff cards with a dot (page 30: C Position, bass C3–G3 and treble C4–G4;
page 34: Middle C Position, bass F3–C4 and treble C4–G4). The staff cards
light one at a time, top to bottom, left column first; the child plays the
note and a line draws itself to the matching letter. Wrong keys get the
usual hints, and the letters appear after two misses. No timer. The reverse
round (a letter lights, the child plays it in the page's position) is not
built.

## Page by page

| Page | Title                                   | Paper task                                      | Game              | Status |
| ---: | --------------------------------------- | ----------------------------------------------- | ----------------- | ------ |
|    4 | Middle C Position Review                | Color areas by note (A–G, Middle C Position)    | Color by Note     | Built  |
|    5 | Left Hand and Right Hand                | Color the hand, play                            | Together or Apart | Built  |
|    6 | Note Values                             | Line from note to counts (4/4 or 3/4)           | Hold It!          | Built  |
|    7 | Bass Clef C                             | Color Middle C and Bass Clef C on keyboard      | Crayon Keys       | Built  |
|    8 | Middle C and Bass Clef C                | Color areas by note                             | Color by Note     | Built  |
|    9 | Bass Clef D                             | Color Treble D and Bass D on keyboard           | Crayon Keys       | Built  |
|   10 | Treble Clef D and Bass Clef D           | Color areas by note                             | Color by Note     | Built  |
|   11 | Bass Clef E                             | Color Treble E and Bass E on keyboard           | Crayon Keys       | Built  |
|   12 | Treble Clef E and Bass Clef E           | Color areas by note                             | Color by Note     | Built  |
|   13 | Steps, Skips and Repeats                | Circle steps, skips, repeats                    | Interval Hop      | Built  |
|   14 | C Position for the Left Hand            | Color LH C Position C–G on keyboard             | Crayon Keys       | Built  |
|   15 | Staccato                                | Circle staccato notes                           | Hold It!          | Built  |
|   16 | Rests                                   | Line from rest to counts                        | Hold It!          | Built  |
|   17 | Staccato                                | Listen: staccato or not                         | Ear Detective     | Built  |
|   18 | Rhythm Patterns in 4/4 Time             | Listen: circle the clapped rhythm               | Ear Detective     | Built  |
|   19 | 2nds                                    | Color G and F; circle 2nds up and down          | Interval Hop      | Built  |
|   20 | 2nds                                    | Circle each 2nd                                 | Interval Hop      | Built  |
|   21 | C Position                              | Color areas C–G (Talent Show)                   | Color by Note     | Built  |
|   22 | Rhythm Patterns                         | Listen: circle the clapped rhythm (3/4 and 4/4) | Ear Detective     | Built  |
|   23 | 3rds                                    | Color G and E; circle 3rds up and down          | Interval Hop      | Built  |
|   24 | 3rds                                    | Circle each 3rd                                 | Interval Hop      | Built  |
|   25 | Melodies with 2nds and 3rds             | Listen: circle the melody                       | Ear Detective     | Built  |
|   26 | 2nds and 3rds                           | Color areas by interval                         | Color by Note     | Built  |
|   27 | Staccato and Legato Melodies            | Listen: circle the melody                       | Ear Detective     | Built  |
|   28 | Same and Different                      | Same or different intervals                     | Interval Hop      | Built  |
|   29 | Left Hand and Right Hand                | Color the hand, trace the slur, play            | Together or Apart | Built  |
|   30 | C Position                              | Line from letter to staff note                  | Note Snap         | Built  |
|   31 | Harmonic Intervals                      | Circle notes played together                    | Together or Apart | Built  |
|   32 | Melodic Intervals                       | Circle notes played separately                  | Together or Apart | Built  |
|   33 | Melodic and Harmonic Intervals          | Color areas by interval kind                    | Color by Note     | Built  |
|   34 | Middle C Position                       | Line from letter to staff note                  | Note Snap         | Built  |
|   35 | Hands Together                          | Circle examples played hands together           | Together or Apart | Built  |
|   36 | C, D, E, F and G                        | Color Bass C–G on keyboard and staff            | Crayon Keys       | Built  |
|   37 | C and E                                 | Color C and E on keyboard and staff             | Crayon Keys       | Built  |
|   38 | D and G                                 | Color D and G on keyboard and staff             | Crayon Keys       | Built  |
|   39 | 4ths                                    | Color C, F, G; circle 4ths up and down          | Interval Hop      | Built  |
|   40 | 4ths                                    | Circle each 4th                                 | Interval Hop      | Built  |
|   41 | 2nds, 3rds and 4ths                     | Circle 2, 3 or 4 for each interval              | Interval Hop      | Built  |
|   42 | F and G                                 | Color Treble F and Bass G on keyboard and staff | Crayon Keys       | Built  |
|   43 | 5ths                                    | Color C and G; circle 5ths up and down          | Interval Hop      | Built  |
|   44 | 5ths                                    | Circle each 5th                                 | Interval Hop      | Built  |
|   45 | 4ths and 5ths                           | Color areas by interval                         | Color by Note     | Built  |
|   46 | Melodies with 2nds, 3rds, 4ths and 5ths | Listen: circle the melody                       | Ear Detective     | Built  |
|   47 | Same and Different                      | Same or different intervals                     | Interval Hop      | Built  |
|   48 | C Position and Middle C Position        | Color areas A–G (Market)                        | Color by Note     | Built  |

When a game ships, change its pages' status to **Built** and update the
counts in [Coverage](#coverage).

## What the app already has

- USB MIDI input and output: `src/midi.ts`
- Piano sound and laptop sound: `src/audio.ts`, `src/pianoSound.ts`
- Staff drawing with the Bravura font: `src/notation.ts`
- On-screen keyboard: `src/render.ts`
- Notes that start together (chords): `chords()` in `src/engine.ts`
- Metronome and count-in: `src/metronome.ts`
- Practice calendar: `src/practiceLog.ts`, `src/PracticeCalendar.tsx`
- Books list, where Music Workbook 3 can join the Lesson and Recital books:
  `src/books.ts`
