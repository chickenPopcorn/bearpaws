/** A title with its first letter as a decorative initial, read whole. */
export function SongTitle({ title }: { title: string }) {
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
