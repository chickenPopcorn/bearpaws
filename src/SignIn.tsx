import { useState } from "react";

/** The page shown until someone signs in with Google. */
export function SignIn({
  error,
  onSignIn,
  onLocal,
}: {
  error: string;
  onSignIn: () => Promise<void>;
  onLocal?: () => void;
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
        {onLocal && (
          <button type="button" className="text-button" onClick={onLocal}>
            Open local development studio
          </button>
        )}
        {message && (
          <p className="signin-error" role="alert">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}
