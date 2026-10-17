import { useEffect, useEffectEvent, useState } from "react";
import { isBuiltInSong } from "./lessons";
import { collections, collectionForSong } from "./collections";
import type { Song } from "./song";

const searchText = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
const songMatches = (song: Song, term: string) =>
  searchText(`${song.title} ${song.lesson?.composer ?? ""}`).includes(term);

export function SongLibrary({
  songs,
  selected,
  onSelect,
  onImport,
}: {
  songs: Song[];
  selected: string;
  onSelect(song: Song): void;
  onImport(): void;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState({
    classes: true,
    songs: true,
    pops: true,
  });
  const revealSelection = useEffectEvent(() => {
    const group = collectionForSong(selected).id;
    setExpanded((current) => ({ ...current, [group]: true }));
    const song = songs.find((song) => song.id === selected);
    setQuery((current) =>
      song && !songMatches(song, searchText(current.trim())) ? "" : current,
    );
  });
  useEffect(() => {
    revealSelection();
  }, [selected]);
  const term = searchText(query.trim());
  const groups = collections.map((group) => ({
    ...group,
    songs: songs.filter((song) => collectionForSong(song.id).id === group.id),
  }));
  return (
    <>
      <div className="nav-label">
        My library <span>{songs.length}</span>
      </div>
      <input
        type="search"
        className="library-search"
        aria-label="Search songs"
        placeholder="Find a song…"
        value={query}
        onChange={(event) => {
          const value = event.target.value;
          setQuery(value);
          if (value.trim())
            setExpanded({ classes: true, songs: true, pops: true });
        }}
      />
      {groups.map((group) => {
        const visible = group.songs.filter((song) => songMatches(song, term));
        return (
          <section className="library-section" key={group.id}>
            <button
              className="library-section-toggle"
              aria-expanded={expanded[group.id]}
              aria-controls={`library-${group.id}`}
              onClick={() =>
                setExpanded((current) => ({
                  ...current,
                  [group.id]: !current[group.id],
                }))
              }
            >
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="m4.5 2.5 3.5 3.5-3.5 3.5" />
              </svg>
              <span>{group.title}</span>
              <span className="library-section-count" aria-hidden="true">
                {group.songs.length}
              </span>
            </button>
            <div id={`library-${group.id}`} hidden={!expanded[group.id]}>
              <div className="library-songs" aria-label={group.title}>
                {visible.map((song) => (
                  <button
                    key={song.id}
                    className="song"
                    aria-pressed={song.id === selected}
                    onClick={() => onSelect(song)}
                  >
                    {song.title}
                    <small>
                      {song.lesson
                        ? `${song.lesson.level} · ${song.lesson.bpm} BPM · Fingering`
                        : isBuiltInSong(song.id)
                          ? "Original exercise · Both hands"
                          : "Imported MIDI · On this browser"}
                    </small>
                  </button>
                ))}
                {!visible.length && (
                  <p className="library-empty">
                    {term
                      ? "No matches in this section."
                      : "Songs you add will appear here."}
                  </p>
                )}
              </div>
              {group.id === "songs" && (
                <button className="import" onClick={onImport}>
                  ＋ Import MIDI
                </button>
              )}
            </div>
          </section>
        );
      })}
      <a
        className="library-download"
        href={`${import.meta.env.BASE_URL}midi/cadence-starter-library.zip`}
        download
      >
        Download starter MIDI pack
      </a>
    </>
  );
}
