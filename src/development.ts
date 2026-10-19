/** Compile-time DEV guard keeps the local account out of production builds. */
export const localDevelopment =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("local") === "1";
