import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { OpeningStudio } from "./OpeningStudio";
import {
  getGate,
  leaveFailedSignIn,
  settled,
  signOut,
  subscribeGate,
  useHere,
  watchAuth,
} from "./session";
import { SignIn } from "./SignIn";
import { signInWithGoogle } from "./supabase";
import "./style.css";

const container = document.getElementById("root")!;
/** After a refresh, src/reloadSnapshot.ts has put the page as it was left back. */
const snapshotOnScreen = container.hasChildNodes();
watchAuth();

/** Shows sign-in, loading and errors, then the studio. */
function Root() {
  const current = useSyncExternalStore(subscribeGate, getGate);
  if (current.status === "ready")
    return (
      <App
        key={current.userId}
        email={current.email}
        onSignOut={() => void signOut()}
      />
    );
  if (current.status === "loading") return <OpeningStudio error="" />;
  if (current.status === "signing-out")
    return <OpeningStudio error="" message="Signing out…" />;
  if (current.status === "elsewhere")
    return (
      <OpeningStudio
        error="Paw Pal is open in another tab. Practice there, or move it here."
        action={{ label: "Use here", onClick: () => void useHere() }}
      />
    );
  if (current.status === "failed")
    return (
      <OpeningStudio
        error={current.error}
        onSignOut={() => void leaveFailedSignIn()}
      />
    );
  return (
    <SignIn
      error={current.error}
      onSignIn={async () => {
        const { error } = await signInWithGoogle();
        if (error) throw error;
      }}
    />
  );
}

const root = createRoot(container);
const render = () => root.render(<Root />);
// While the page as it was left is on screen, keep it there until sign-in
// settles (briefly), so the first render shows the studio rather than a
// loading screen. With nothing on screen, rendering now beats a blank wait.
if (!snapshotOnScreen) render();
else
  void Promise.race([
    settled,
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]).then(render);
