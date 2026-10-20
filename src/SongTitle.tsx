/**
 * A title with its first letter as a decorative initial, read whole. A title
 * that starts with a number has none.
 */
export function SongTitle({ title }: { title: string }) {
  const letter = /\p{L}/u.exec(title);
  // "2nds and 3rds" starts with a number: no initial in mid-word.
  if (!letter || /^\p{N}/u.test(title)) return <>{title}</>;
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
