import { useState } from "react";

/**
 * Seconds for one end of the loop. A step (the stepper or arrow keys) applies
 * at once. Typed text waits for blur or Enter: every applied value restarts
 * the loop, and clamping would rewrite a number that is still being typed.
 * Key it by song, so a song change discards an unfinished draft.
 */
export function LoopBoundInput({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit(seconds: number): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const finish = () => {
    const seconds = Number(draft);
    if (draft?.trim() && Number.isFinite(seconds) && seconds !== value)
      onCommit(seconds);
    setDraft(null);
  };
  return (
    <input
      type="number"
      aria-label={label}
      min={min}
      max={max}
      step=".1"
      value={draft ?? Number(value.toFixed(2))}
      onChange={(event) => {
        const text = event.target.value;
        const seconds = Number(text);
        setDraft(text);
        // Text editing arrives as an InputEvent with an inputType; a step does not.
        const typed = Boolean((event.nativeEvent as InputEvent).inputType);
        if (
          !typed &&
          text.trim() &&
          seconds >= min &&
          seconds <= max &&
          seconds !== value
        )
          onCommit(seconds);
      }}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish();
      }}
    />
  );
}
