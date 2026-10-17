/**
 * Paint a canvas now, then again only when it can look different: after a
 * store change, a resize, a device pixel ratio change (another display or
 * browser zoom), or a web font finishing loading. Triggers within one frame
 * share a single paint, and nothing runs while the canvas is unchanged.
 */
export function watchCanvasRedraws(
  canvas: HTMLCanvasElement,
  subscribe: (listener: () => void) => () => unknown,
  paint: () => void,
) {
  let frame = 0,
    disposed = false;
  const request = () => {
    if (frame || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  };
  const unsubscribe = subscribe(request);
  const resize = new ResizeObserver(request);
  resize.observe(canvas);
  // A resolution query matches only the current ratio, so re-arm it on change.
  let ratio: MediaQueryList | undefined;
  const ratioChanged = () => {
    watchRatio();
    request();
  };
  const watchRatio = () => {
    ratio?.removeEventListener("change", ratioChanged);
    ratio = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    ratio.addEventListener("change", ratioChanged);
  };
  watchRatio();
  // Labels drawn before the score font arrives use a fallback face.
  const fonts = document.fonts;
  void fonts?.ready.then(request);
  fonts?.addEventListener("loadingdone", request);
  paint();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    unsubscribe();
    resize.disconnect();
    ratio?.removeEventListener("change", ratioChanged);
    fonts?.removeEventListener("loadingdone", request);
  };
}
