import { useEffect, useEffectEvent, useRef } from "react";

export function usePracticeShortcuts({
  enabled = true,
  busy,
  onEnter,
  onTogglePlayback,
  onPreviousSong,
  onNextSong,
}: {
  /** False while the studio's practice is hidden, as on a workbook page. */
  enabled?: boolean;
  busy: boolean;
  onEnter(): void;
  onTogglePlayback(): void;
  onPreviousSong(): void;
  onNextSong(): void;
}) {
  const spaceHeld = useRef(false);
  const down = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      !enabled ||
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      target?.closest(
        'input,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"],[role="spinbutton"],[role="combobox"],[role="listbox"],[role="grid"],[role="treegrid"],[role="tree"],[role="tablist"],[role="menu"],[role="menubar"],[role="radiogroup"],[role="toolbar"]',
      )
    )
      return;

    const control = target?.closest(
      'button,a[href],summary,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"]',
    );
    const playbackControl = control?.matches(".play");
    const fullscreenControl = control?.matches(".fullscreen-toggle");

    if (event.key === " " || event.code === "Space") {
      if (control && !playbackControl && !fullscreenControl) return;
      // Full screen initially focuses Exit; Space must control playback there too.
      event.preventDefault();
      if (event.repeat || spaceHeld.current) return;
      spaceHeld.current = true;
      if (!busy) onTogglePlayback();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      // Consume global navigation only; focused widgets keep their own keys.
      event.stopPropagation();
      if (event.repeat || busy) return;
      if (event.key === "ArrowLeft") onPreviousSong();
      else onNextSong();
    } else if (event.key === "Enter") {
      if (control && !playbackControl && !fullscreenControl) return;
      event.preventDefault();
      if (event.repeat) return;
      if (playbackControl) {
        if (!busy) onTogglePlayback();
      } else onEnter();
    }
  });

  useEffect(() => {
    const up = (event: KeyboardEvent) => {
      if ((event.key === " " || event.code === "Space") && spaceHeld.current) {
        event.preventDefault();
        spaceHeld.current = false;
      }
    };
    const blur = () => {
      spaceHeld.current = false;
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
    };
  }, []);
}
