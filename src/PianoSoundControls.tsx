import { useId, useRef, useState } from "react";
import type { PianoSoundProfile } from "./pianoSound";

export function PianoSoundControls({
  profile,
  ambience,
  onChange,
}: {
  profile: PianoSoundProfile;
  ambience: number;
  onChange(profile: PianoSoundProfile, ambience: number): void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const profileSelect = useRef<HTMLSelectElement>(null);
  const [position, setPosition] = useState({ top: 16, left: 16 });
  return (
    <div
      className="piano-sound"
      onKeyDown={(event) => {
        if (event.key === "Escape" && panel.current?.matches(":popover-open"))
          event.stopPropagation();
      }}
    >
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
        ref={panel}
        id={id}
        popover="auto"
        className="piano-sound-panel"
        style={position}
        role="group"
        aria-label="Piano sound options"
        onToggle={(event) => {
          if (event.newState === "open") profileSelect.current?.focus();
        }}
        onKeyDown={(event) => {
          // Let the browser close the popover without exiting piano fullscreen.
          if (event.key === "Escape") event.stopPropagation();
        }}
      >
        <label htmlFor={`${id}-profile`}>Sound</label>
        <select
          ref={profileSelect}
          id={`${id}-profile`}
          value={profile}
          autoFocus
          onChange={(event) =>
            onChange(event.target.value as PianoSoundProfile, ambience)
          }
        >
          <option value="natural">Natural</option>
          <option value="original">Original · dry</option>
        </select>
        <div className="piano-sound-amount">
          <label htmlFor={`${id}-room`}>Room</label>
          <output htmlFor={`${id}-room`}>
            {profile === "original" ? "Off" : `${Math.round(ambience * 100)}%`}
          </output>
        </div>
        <input
          id={`${id}-room`}
          type="range"
          min="0"
          max="100"
          step="1"
          value={Math.round(ambience * 100)}
          disabled={profile === "original"}
          onChange={(event) =>
            onChange(profile, Number(event.target.value) / 100)
          }
        />
        <p>
          {profile === "natural"
            ? "Gentle dynamics with a little room around each note."
            : "The previous sound, for comparison."}
        </p>
      </div>
    </div>
  );
}
