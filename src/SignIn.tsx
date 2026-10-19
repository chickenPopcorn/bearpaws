import { useState } from "react";

/** Shown while the account loads or signs out, or when it could not load. */
export function OpeningStudio({
  error,
  message = "Opening your studio…",
  onSignOut,
}: {
  error: string;
  message?: string;
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
              onClick={() => window.location.reload()}
            >
              Try again
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

/** The page shown until someone signs in with Google. */
export function SignIn({
  error,
  onSignIn,
}: {
  error: string;
  onSignIn: () => Promise<void>;
}) {
  const [leaving, setLeaving] = useState(false);
  const [failure, setFailure] = useState("");
  const message = failure || error;
  return (
    <main className="signin">
      <div className="signin-card">
        <img
          className="brand-mark"
          src={`${import.meta.env.BASE_URL}bearpaws.svg?v=3`}
          alt=""
          width="56"
          height="56"
        />
        <h1>Paw Pal</h1>
        <p>Sign in to keep your practice progress on every device.</p>
        <button
          type="button"
          className="signin-google"
          disabled={leaving}
          onClick={() => {
            setLeaving(true);
            setFailure("");
            onSignIn().catch(() => {
              setLeaving(false);
              setFailure("Google sign-in could not start. Please try again.");
            });
          }}
        >
          Continue with Google
        </button>
        {message && (
          <p className="signin-error" role="alert">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}
