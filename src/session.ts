import { Studio } from "./controller";
import { BrowserStorageError, CloudSync, UnsentChangesError } from "./cloud";
import { LIBRARY_BUCKET, loadLibrary } from "./library";
import type { Song } from "./song";
import { StudioClaim } from "./studioClaim";
import { firstName, supabase } from "./supabase";

/** What the page shows: sign-in, loading and errors, or the studio. */
export type Gate =
  | { status: "loading" }
  | { status: "signing-out" }
  | { status: "elsewhere" }
  | { status: "failed"; error: string }
  | { status: "signed-out"; error: string }
  | { status: "ready"; userId: string; email: string };

// One studio per signed-in session, created once the account's songs and
// progress are on this browser. App only renders while it exists.
export let studio!: Studio;
export let cloud: CloudSync | null = null;

let gate: Gate = { status: "loading" };
export const getGate = () => gate;
const gateListeners = new Set<() => void>();
let settle!: () => void;
/** Resolves once sign-in has decided what to show first. */
export const settled = new Promise<void>((resolve) => (settle = resolve));
function setGate(next: Gate) {
  gate = next;
  if (next.status !== "loading") settle();
  for (const listener of gateListeners) listener();
}
export const subscribeGate = (listener: () => void) => {
  gateListeners.add(listener);
  return () => gateListeners.delete(listener);
};
// The user whose studio is open or opening: null until the first auth event
// says whether anyone is signed in, and "" once nobody is.
export let currentUser: string | null = null;

/** The public URL of a file in the song library bucket. */
const libraryUrl = (path: string) =>
  `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/${LIBRARY_BUCKET}/${path}`;
let library: Promise<Song[]> | undefined;
/** The song library, loaded once per page; a failed load is tried again. */
function loadSongs() {
  library ??= loadLibrary(libraryUrl).catch((error) => {
    library = undefined;
    throw error;
  });
  return library;
}
/** The open studio's session, to return to if sign-out fails. */
let readyGate: Extract<Gate, { status: "ready" }> | null = null;
/** The sign-in still loading, so a newer auth event can stop it. */
let loading: CloudSync | null = null;
let currentEmail = "";
/** The account's first name, the learner's name until someone changes it. */
let currentName = "";
/** This tab's claim on the studio, which only one tab runs at a time. */
const claim = new StudioClaim(() => {
  // Another tab took the studio over, and with it the stored upload queue.
  // The final save stays in this tab's memory, and its progress is sent
  // from here before syncing stops (see CloudSync.handOff()).
  loading?.stop();
  loading = null;
  if (cloud) {
    const sync = cloud;
    cloud = null;
    sync.detach();
    studio.destroy();
    void sync.handOff();
  }
  if (currentUser) setGate({ status: "elsewhere" });
});

async function openSession(userId: string, email: string, name = "") {
  if (userId === currentUser) return;
  currentUser = userId;
  loading?.stop();
  loading = null;
  // The session ended or changed outside this page's Sign out button, such as
  // in another tab: close the studio and stop its sync, so nothing more is
  // sent for the old session. Supabase has already signed out.
  if (cloud) {
    studio.destroy();
    cloud.stop();
    cloud = null;
  }
  if (!userId) {
    claim.give();
    setGate({ status: "signed-out", error: "" });
    return;
  }
  currentEmail = email;
  currentName = name;
  const claimed = await claim.claim();
  if (currentUser !== userId) {
    // A newer auth event moved on while the claim was pending. A lock that
    // arrived anyway goes to the session now current, or back to other tabs.
    if (claimed && claim.held && !cloud && !loading)
      if (!currentUser) claim.give();
      else if (gate.status === "elsewhere")
        await openStudio(currentUser, currentEmail);
    return;
  }
  if (!claimed) {
    setGate({ status: "elsewhere" });
    return;
  }
  await openStudio(userId, email);
}

/** Take the studio over from another tab. */
export async function takeOverHere() {
  const userId = currentUser;
  if (!userId) return;
  await claim.claim(true);
  if (currentUser === userId && !cloud && !loading)
    await openStudio(userId, currentEmail);
}

/** Load the account and the library, then open the studio. */
async function openStudio(userId: string, email: string) {
  const client = supabase!;
  setGate({ status: "loading" });
  const sync = new CloudSync(client, userId);
  loading = sync;
  let songs: Song[];
  try {
    [songs] = await Promise.all([loadSongs(), sync.pull()]);
  } catch (error) {
    // Replaced meanwhile, or another tab took the studio over: that state
    // stays on screen.
    if (currentUser !== userId || loading !== sync) return;
    // Still signed in: offer a retry, not another Google sign-in.
    setGate({
      status: "failed",
      error:
        error instanceof BrowserStorageError
          ? error.message
          : "Your songs could not be loaded. Check your connection and try again.",
    });
    return;
  }
  if (currentUser !== userId || loading !== sync) return;
  loading = null;
  cloud = sync;
  studio = new Studio(songs, sync);
  sync.onChange = () => studio.emit();
  // Signed in, the learner has a name from the start: the account's.
  // Once only: a name cleared on purpose stays blank.
  if (
    !studio.settings.learnerNameChosen &&
    !studio.settings.learnerName.trim() &&
    currentName
  )
    studio.learnerName(currentName);
  readyGate = { status: "ready", userId, email };
  setGate(readyGate);
}

/**
 * Sign `sync` out. If some practice has not reached the account, ask before
 * dropping it; throws, still signed in, if the answer is no or sign-out fails.
 */
async function endSession(sync: CloudSync) {
  try {
    await sync.signOut();
  } catch (error) {
    if (
      !(error instanceof UnsentChangesError) ||
      !window.confirm(
        `${error.message} Sign out anyway? It will be lost on this browser.`,
      )
    )
      throw error;
    await sync.signOut({ force: true });
  }
  claim.give();
}

export async function signOut() {
  if (!cloud) return;
  const sync = cloud;
  // Close the studio first: its final save joins the upload, and nothing can
  // change while signing out.
  studio.destroy();
  setGate({ status: "signing-out" });
  try {
    await endSession(sync);
  } catch (error) {
    // Still signed in: reopen the studio, and say why, unless another tab
    // has since opened a different session here.
    if (cloud !== sync) return;
    studio.notice =
      error instanceof UnsentChangesError
        ? "Still signed in. Your practice keeps trying to reach your account."
        : "Sign-out failed. Check your connection and try again.";
    if (readyGate) setGate(readyGate);
    return;
  }
  // Another tab may have changed the session while this one signed out: then
  // the newer session's studio and sync are not this sign-out's to close.
  if (cloud !== sync) return;
  cloud = null;
  currentUser = "";
  setGate({ status: "signed-out", error: "" });
}

/** Sign out of a sign-in that could not finish loading. */
export async function leaveFailedSignIn() {
  const sync = loading;
  if (!sync) return;
  const failed = gate;
  setGate({ status: "signing-out" });
  try {
    await endSession(sync);
  } catch (error) {
    if (loading !== sync) return;
    setGate(
      failed.status === "failed" && !(error instanceof UnsentChangesError)
        ? {
            ...failed,
            error: "Sign-out failed. Check your connection and try again.",
          }
        : failed,
    );
    return;
  }
  // The auth event may already have moved on to a newer session.
  if (loading !== sync) return;
  loading = null;
  currentUser = "";
  setGate({ status: "signed-out", error: "" });
}

/**
 * Follow the account's sign-in from the moment the page loads, outside React,
 * so a refresh can keep the page as it was left on screen until the studio is
 * ready.
 */
export function watchAuth() {
  if (supabase) {
    // Supabase asks that auth callbacks not await its own calls directly.
    supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(
        () =>
          void openSession(
            session?.user.id ?? "",
            session?.user.email ?? "",
            firstName(session?.user),
          ),
        0,
      );
    });
  } else {
    setGate({
      status: "signed-out",
      error: "Sign-in is not set up for this site.",
    });
  }
}
