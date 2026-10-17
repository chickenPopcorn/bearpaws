import { useId, useRef, useState } from "react";

export function PianoSoundControls({
  ambience,
  onChange,
}: {
  ambience: number;
  onChange(ambience: number): void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const roomInput = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState({ top: 16, left: 16 });
  return (
    <div className="piano-sound">
      <button
        ref={trigger}
        popoverTarget={id}
        onClick={() => {
          const bounds = trigger.current!.getBoundingClientRect();
          setPosition({
            top: Math.max(
              16,
              Math.min(bounds.bottom + 8, window.innerHeight - 240),
            ),
            left: Math.max(
              16,
              Math.min(bounds.right - 240, window.innerWidth - 256),
            ),
          });
        }}
      >
        Piano sound
      </button>
      <div
        id={id}
        popover="auto"
        className="piano-sound-panel"
        style={position}
        role="group"
        aria-label="Piano sound options"
        onToggle={(event) => {
          if (event.newState === "open") roomInput.current?.focus();
        }}
      >
        <strong className="piano-sound-name">Natural piano</strong>
        <div className="piano-sound-amount">
          <label htmlFor={`${id}-room`}>Room</label>
          <output htmlFor={`${id}-room`}>{Math.round(ambience * 100)}%</output>
        </div>
        <input
          ref={roomInput}
          id={`${id}-room`}
          type="range"
          min="0"
          max="100"
          step="1"
          value={Math.round(ambience * 100)}
          onChange={(event) => onChange(Number(event.target.value) / 100)}
        />
        <p>Gentle dynamics with a little room around each note.</p>
      </div>
    </div>
  );
}
