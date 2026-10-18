/**
 * The app renders only once its script has loaded, so a refresh would first
 * show the empty page. On leaving, keep the rendered markup for this tab; a
 * script in index.html puts it back before the app loads, and the first render
 * replaces it. Markup lacks canvas pixels, so those are kept as images.
 */
export const RELOAD_SNAPSHOT_KEY = "cadence:reload-snapshot";

const store = (snapshot: { html: string; canvases: string[] }) => {
  try {
    sessionStorage.setItem(RELOAD_SNAPSHOT_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
};

/** Markup of `root`, with form controls showing their current state. */
function markup(root: HTMLElement) {
  const copy = root.cloneNode(true) as HTMLElement;
  const fields = "input, select, textarea";
  const originals = root.querySelectorAll<HTMLElement>(fields);
  copy.querySelectorAll<HTMLElement>(fields).forEach((field, index) => {
    const original = originals[index];
    if (
      original instanceof HTMLInputElement &&
      field instanceof HTMLInputElement
    ) {
      field.setAttribute("value", original.value);
      field.toggleAttribute("checked", original.checked);
    } else if (
      original instanceof HTMLSelectElement &&
      field instanceof HTMLSelectElement
    ) {
      [...field.options].forEach((option, i) =>
        option.toggleAttribute("selected", !!original.options[i]?.selected),
      );
    } else if (original instanceof HTMLTextAreaElement) {
      field.textContent = original.value;
    }
  });
  return copy.innerHTML;
}

export function saveReloadSnapshot(root: HTMLElement) {
  const html = markup(root);
  const canvases = [...root.querySelectorAll("canvas")].map((canvas) => {
    try {
      return canvas.toDataURL("image/webp", 0.8);
    } catch {
      return "";
    }
  });
  // Without room for the images, the markup alone still helps.
  if (store({ html, canvases }) || store({ html, canvases: [] })) return;
  try {
    sessionStorage.removeItem(RELOAD_SNAPSHOT_KEY);
  } catch {
    // Storage is blocked, so there is no older snapshot to show either.
  }
}
