import { useEffect, useRef, useState } from "react";

export function usePianoFullscreen(onEnter: () => void) {
  const stage = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const native = useRef(false);
  const wanted = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const leave = async () => {
    wanted.current = false;
    if (document.fullscreenElement === stage.current) {
      try {
        await document.exitFullscreen();
      } catch {
        // Keep the exit control available if the browser is still fullscreen.
        if (document.fullscreenElement === stage.current) return;
      }
    }
    setExpanded(false);
  };
  const enter = async () => {
    const element = stage.current;
    if (!element) return;
    if (wanted.current || document.fullscreenElement === element) {
      onEnter();
      return;
    }
    previousFocus.current = document.activeElement as HTMLElement | null;
    wanted.current = true;
    setExpanded(true);
    // Start/unlock audio while the click still has transient user activation.
    onEnter();
    if (typeof element.requestFullscreen === "function") {
      try {
        await element.requestFullscreen();
        if (!wanted.current && document.fullscreenElement === element)
          await document.exitFullscreen();
      } catch {
        // The same stage fills the window when native fullscreen is unavailable.
      }
    }
  };
  useEffect(() => {
    const changed = () => {
      if (document.fullscreenElement === stage.current) {
        native.current = true;
        setExpanded(true);
      } else if (native.current) {
        native.current = false;
        wanted.current = false;
        setExpanded(false);
      }
    };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  useEffect(() => {
    const element = stage.current;
    if (!expanded || !element) return;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const outside: { element: HTMLElement; inert: boolean }[] = [];
    for (
      let branch: HTMLElement = element;
      branch.parentElement;
      branch = branch.parentElement
    ) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          outside.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      if (branch.parentElement === document.body) break;
    }
    element.querySelector<HTMLButtonElement>(".fullscreen-toggle")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void leave();
      } else if (event.key === "Tab") {
        const controls = [
          ...element.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
          ),
        ].filter((control) => control.getClientRects().length > 0);
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      document.body.style.overflow = priorOverflow;
      for (const item of outside) item.element.inert = item.inert;
      previousFocus.current?.focus();
    };
  }, [expanded]);
  return { stage, expanded, enter, toggle: expanded ? leave : enter };
}
