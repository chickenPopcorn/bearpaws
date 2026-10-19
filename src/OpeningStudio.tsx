/** Shown while the studio loads or signs out, or when it could not. */
export function OpeningStudio({
  error,
  message = "Opening your studio…",
  action = { label: "Try again", onClick: () => window.location.reload() },
  onSignOut,
}: {
  error: string;
  message?: string;
  /** The way forward offered with an error: by default, a reload. */
  action?: { label: string; onClick: () => void };
  /** Offered with an error, so a shared device can still be signed out. */
  onSignOut?: () => void;
}) {
  return (
    <main className="signin" aria-busy={!error}>
      <div className="signin-card">
        <img
          className="brand-mark"
          src={`${import.meta.env.BASE_URL}bearpaws.svg?v=3`}
          alt=""
          width="56"
          height="56"
        />
        <h1>Paw Pal</h1>
        {error ? (
          <>
            <p className="signin-error" role="alert">
              {error}
            </p>
            <button
              type="button"
              className="signin-google"
              onClick={action.onClick}
            >
              {action.label}
            </button>
            {onSignOut && (
              <button type="button" className="text-button" onClick={onSignOut}>
                Sign out
              </button>
            )}
          </>
        ) : (
          <p role="status">{message}</p>
        )}
      </div>
    </main>
  );
}
