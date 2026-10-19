import { memo, useEffect, useEffectEvent, useRef, useState } from "react";
import {
  books,
  bookForSong,
  CLASSES_TITLE,
  songsInBook,
  type BookId,
} from "./books";
import type { Song } from "./song";

const searchText = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const songMatches = (song: Song, term: string) =>
  searchText(
    `${song.title} ${song.lesson?.composer ?? song.source?.composer ?? ""}`,
  ).includes(term);
const allBooks = (open: boolean) =>
  Object.fromEntries(books.map(({ id }) => [id, open])) as Record<
    BookId,
    boolean
  >;

export const SongLibrary = memo(function SongLibrary({
  songs,
  selected,
  savedSelection,
  onSelect,
}: {
  songs: Song[];
  selected: string;
  /** The song restored at startup, which may load after the first render. */
  savedSelection?: string;
  onSelect(song: Song): void;
}) {
  const [query, setQuery] = useState("");
  // Books start folded, even for the restored song; a later song change opens
  // that song's book.
  const [expanded, setExpanded] = useState(() => allBooks(false));
  const startup = useRef<{ initial: string; saved?: string } | undefined>({
    initial: selected,
    saved: savedSelection,
  });
  const revealSelection = useEffectEvent(() => {
    const book = bookForSong(selected).id;
    setExpanded((current) => ({ ...current, [book]: true }));
    const song = songs.find((song) => song.id === selected);
    setQuery((current) =>
      song && !songMatches(song, searchText(current.trim())) ? "" : current,
    );
  });
  useEffect(() => {
    const pending = startup.current;
    if (
      pending &&
      (selected === pending.initial || selected === pending.saved)
    ) {
      // Startup ends once the saved song is showing.
      if (!pending.saved || selected === pending.saved)
        startup.current = undefined;
      return;
    }
    startup.current = undefined;
    revealSelection();
  }, [selected]);
  const term = searchText(query.trim());
  const groups = books.map((book) => ({
    ...book,
    songs: songsInBook(songs, book.id),
  }));
  return (
    <>
      <div className="nav-label">
        {CLASSES_TITLE} <span>{songs.length}</span>
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
          if (value.trim()) setExpanded(allBooks(true));
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
              <span className="library-section-icon" aria-hidden="true">
                {group.icon}
              </span>
              <span className="library-section-title">
                <small>{group.series}</small>
                {group.title}
              </span>
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
                        : "Full piano · No finger numbers"}
                    </small>
                  </button>
                ))}
                {!visible.length && (
                  <p className="library-empty">
                    {term
                      ? "No matches in this book."
                      : "No songs in this book yet."}
                  </p>
                )}
              </div>
            </div>
          </section>
        );
      })}
    </>
  );
});
