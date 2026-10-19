import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BrowserStorageError, CloudSync } from "../src/cloud";
import { clearAccountData, read, write } from "../src/storage";

vi.mock("../src/storage", async (importActual) => {
  const actual = await importActual<typeof import("../src/storage")>();
  return { ...actual, clearAccountData: vi.fn(actual.clearAccountData) };
});

const USER = "11111111-1111-1111-1111-111111111111";

interface Backend {
  settings: { data: unknown }[];
  progress: { song_id: string; data: unknown }[];
  upserts: [string, unknown][];
  calls: string[];
  failWrites: boolean;
  /** "abort": writes answer only when aborted. "manual": when release() runs. */
  hang: "no" | "abort" | "manual";
  release: () => void;
  signOutError: unknown;
  /** How long Supabase takes to answer a sign-out, in ms. */
  signOutDelay: number;
  /** Makes the settings read fail, as a broken connection would. */
  failReads: boolean;
  /** When set, reads wait for this promise. */
  readGate: Promise<void> | null;
}

function backend(): Backend {
  return {
    settings: [],
    progress: [],
    upserts: [],
    calls: [],
    failWrites: false,
    hang: "no",
    release: () => {},
    signOutError: null,
    signOutDelay: 0,
    failReads: false,
    readGate: null,
  };
}

/** Just the parts of the Supabase client that CloudSync uses. */
function client(b: Backend) {
  const reply = (data: unknown, error: unknown = null) => ({ data, error });
  // A write is sent when the client attaches its abort signal.
  const write = (label: string, upsert?: [string, unknown]) => ({
    abortSignal: (signal: AbortSignal) => {
      b.calls.push(label);
      if (b.hang === "abort")
        return new Promise((resolve) =>
          signal.addEventListener("abort", () =>
            resolve(reply(null, { message: "aborted" })),
          ),
        );
      if (b.hang === "manual")
        return new Promise((resolve) => {
          b.release = () => {
            if (upsert) b.upserts.push(upsert);
            resolve(reply(null));
          };
        });
      if (upsert && !b.failWrites) b.upserts.push(upsert);
      return Promise.resolve(
        reply(null, b.failWrites ? { message: "offline" } : null),
      );
    },
  });
  const fake = {
    from: (table: "settings" | "progress") => ({
      select: () => ({
        maybeSingle: async () => {
          await b.readGate;
          return b.failReads
            ? reply(null, { message: "offline" })
            : reply(b[table][0] ?? null);
        },
        order: () => ({
          range: async (from: number, to: number) => {
            await b.readGate;
            return reply(b[table].slice(from, to + 1));
          },
        }),
      }),
      upsert: (rows: unknown) => write(`upsert ${table}`, [table, rows]),
      delete: () => ({
        in: (_column: string, ids: string[]) =>
          write(`delete ${table} ${ids.join(",")}`),
      }),
    }),
    auth: {
      signOut: vi.fn(async () => {
        if (b.signOutDelay)
          await new Promise((resolve) => setTimeout(resolve, b.signOutDelay));
        return { error: b.signOutError };
      }),
    },
  };
  return fake as unknown as SupabaseClient & typeof fake;
}

const stored = new Map<string, string>();
let storageBlocked = false;
/** A key browser storage refuses, as when it is nearly full. */
let refusedKey = "";
beforeEach(() => {
  stored.clear();
  storageBlocked = false;
  refusedKey = "";
  vi.stubGlobal("localStorage", {
    get length() {
      return stored.size;
    },
    key: (i: number) => [...stored.keys()][i] ?? null,
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (storageBlocked) throw new DOMException("Blocked", "SecurityError");
      if (key === refusedKey)
        throw new DOMException("Full", "QuotaExceededError");
      stored.set(key, value);
    },
    removeItem: (key: string) => void stored.delete(key),
  });
  vi.useFakeTimers();
  vi.mocked(clearAccountData).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const unsynced = () =>
  read<{ settings?: boolean; progress?: string[]; deleted?: string[] }>(
    "unsynced",
    {},
  );

describe("account sync", () => {
  it("lets this browser's unconfirmed changes win, and the account decide the rest", async () => {
    const b = backend();
    write("owner", USER);
    write("unsynced", { progress: ["changed-here"] });
    write("settings", { mode: "listen" });
    write("progress:changed-here", { best: 7 });
    write("progress:stale-here", { best: 1 });
    write("progress:removed-elsewhere", { best: 3 });
    b.settings = [{ data: { mode: "rhythm" } }];
    b.progress = [
      { song_id: "changed-here", data: { best: 2 } },
      { song_id: "stale-here", data: { best: 9 } },
      { song_id: "only-there", data: { best: 5 } },
    ];
    const sync = new CloudSync(client(b), USER);
    await sync.pull();

    expect(read("settings", {})).toEqual({ mode: "rhythm" });
    expect(read("progress:changed-here", {})).toEqual({ best: 7 });
    expect(read("progress:stale-here", {})).toEqual({ best: 9 });
    expect(read("progress:only-there", {})).toEqual({ best: 5 });
    expect(read("progress:removed-elsewhere", null)).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    // The server stamps updated_at; the browser does not send one.
    expect(b.upserts).toEqual([
      [
        "progress",
        [{ user_id: USER, song_id: "changed-here", data: { best: 7 } }],
      ],
    ]);
    expect(unsynced()).toEqual({ settings: false, progress: [], deleted: [] });
  });

  it("uploads an unconfirmed settings change over the account's", async () => {
    const b = backend();
    write("owner", USER);
    write("unsynced", { settings: true });
    write("settings", { mode: "listen" });
    b.settings = [{ data: { mode: "rhythm" } }];
    await new CloudSync(client(b), USER).pull();
    await vi.advanceTimersByTimeAsync(0);
    expect(read("settings", {})).toEqual({ mode: "listen" });
    expect(b.upserts).toEqual([
      ["settings", { user_id: USER, data: { mode: "listen" } }],
    ]);
  });

  it("adopts this browser's earlier data where a new account has none", async () => {
    const b = backend();
    write("settings", { mode: "listen" });
    write("progress:only-here", { best: 4 });
    write("progress:also-there", { best: 1 });
    b.progress = [{ song_id: "also-there", data: { best: 8 } }];
    await new CloudSync(client(b), USER).pull();
    await vi.advanceTimersByTimeAsync(0);
    expect(read("owner", "")).toBe(USER);
    expect(read("progress:also-there", {})).toEqual({ best: 8 });
    expect(b.upserts).toEqual([
      ["settings", { user_id: USER, data: { mode: "listen" } }],
      [
        "progress",
        [{ user_id: USER, song_id: "only-here", data: { best: 4 } }],
      ],
    ]);
  });

  it("adopts again after a first pull that could not save its marker", async () => {
    const b = backend();
    write("progress:only-here", { best: 4 });
    refusedKey = "cadence:unsynced";
    await expect(new CloudSync(client(b), USER).pull()).rejects.toBeInstanceOf(
      BrowserStorageError,
    );
    // Not yet the owner, so the retry still adopts this browser's progress.
    expect(read("owner", null)).toBeNull();
    refusedKey = "";
    await new CloudSync(client(b), USER).pull();
    await vi.advanceTimersByTimeAsync(0);
    expect(read("progress:only-here", null)).toEqual({ best: 4 });
    expect(b.upserts).toEqual([
      [
        "progress",
        [{ user_id: USER, song_id: "only-here", data: { best: 4 } }],
      ],
    ]);
  });

  it("keeps another tab's unconfirmed changes in the shared marker", async () => {
    const b = backend();
    const tabA = new CloudSync(client(b), USER);
    const tabB = new CloudSync(client(b), USER);
    b.failWrites = true;
    tabA.progress("a", { best: 1 } as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(unsynced().progress).toEqual(["a"]);
    b.failWrites = false;
    tabB.progress("b", { best: 2 } as never);
    expect(unsynced().progress).toEqual(["a", "b"]);
    // Tab B's upload confirms only its own change.
    await tabB.flush();
    expect(unsynced().progress).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(15000);
    expect(unsynced().progress).toEqual([]);
    tabA.stop();
    tabB.stop();
  });

  it("clears another account's settings and progress before loading this one", async () => {
    write("owner", "someone-else");
    write("progress:theirs", { best: 1 });
    await new CloudSync(client(backend()), USER).pull();
    expect(clearAccountData).toHaveBeenCalledOnce();
    expect(read("progress:theirs", null)).toBeNull();
    expect(read("owner", "")).toBe(USER);
  });

  it("refuses to open when this browser cannot store the account's data", async () => {
    const b = backend();
    b.settings = [{ data: { mode: "rhythm" } }];
    storageBlocked = true;
    await expect(new CloudSync(client(b), USER).pull()).rejects.toBeInstanceOf(
      BrowserStorageError,
    );
  });

  it("gives up on a request that does not answer", async () => {
    const api = client(backend());
    api.from = (() => ({
      select: () => ({
        maybeSingle: () => new Promise(() => {}),
        order: () => ({ range: () => new Promise(() => {}) }),
      }),
    })) as never;
    const pull = new CloudSync(api, USER).pull();
    const failure = expect(pull).rejects.toThrow(/did not respond/);
    await vi.advanceTimersByTimeAsync(30000);
    await failure;
  });

  it("uploads a burst once, remembers it until confirmed, and retries a failure", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    const onChange = vi.fn();
    sync.onChange = onChange;
    sync.settings({ mode: "wait" } as never);
    sync.progress("song", { best: 1 } as never);
    sync.progress("song", { best: 2 } as never);
    expect(unsynced()).toEqual({
      settings: true,
      progress: ["song"],
      deleted: [],
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(b.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.calls).toEqual(["upsert settings", "upsert progress"]);
    expect(b.upserts[1][1]).toEqual([
      { user_id: USER, song_id: "song", data: { best: 2 } },
    ]);
    expect(unsynced()).toEqual({ settings: false, progress: [], deleted: [] });

    b.failWrites = true;
    sync.progress("song", { best: 3 } as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.error).toMatch(/Retrying/);
    expect(unsynced().progress).toEqual(["song"]);
    expect(onChange).toHaveBeenCalled();
    b.failWrites = false;
    await vi.advanceTimersByTimeAsync(15000);
    expect(sync.error).toBe("");
    expect(sync.pending).toBe(false);
    expect(b.upserts.at(-1)?.[1]).toEqual([
      { user_id: USER, song_id: "song", data: { best: 3 } },
    ]);
  });

  it("uploads only what changed since the account last had it", async () => {
    const b = backend();
    write("owner", USER);
    b.settings = [{ data: { mode: "wait", speed: 1 } }];
    b.progress = [{ song_id: "song", data: { best: 1, updated: 10 } }];
    const sync = new CloudSync(client(b), USER);
    await sync.pull();
    // An idle page saving what it loaded must not overwrite newer practice
    // from another device. Saves rewrite updated, and key order can differ.
    sync.settings({ speed: 1, mode: "wait", updated: 20 } as never);
    sync.progress("song", { updated: 30, best: 1 } as never);
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.calls).toEqual([]);
    expect(sync.pending).toBe(false);

    sync.progress("song", { best: 2 } as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.calls).toEqual(["upsert progress"]);
    // Once confirmed, the same save again is not a change.
    sync.progress("song", { best: 2, updated: 40 } as never);
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.calls).toEqual(["upsert progress"]);
    // A removed song saved again is a change, even with the same content.
    sync.forgetProgress("song");
    sync.progress("song", { best: 2 } as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.calls).toEqual(["upsert progress", "upsert progress"]);
  });

  it("uploads at once and says so when storage cannot hold the marker", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    storageBlocked = true;
    sync.progress("song", { best: 1 } as never);
    // A reload now would let the account's older copy win, so do not wait.
    expect(sync.error).toMatch(/storage is full/);
    await vi.advanceTimersByTimeAsync(0);
    expect(b.calls).toEqual(["upsert progress"]);
    expect(sync.error).toBe("");
  });

  it("aborts a timed-out upload and holds newer changes until it settles", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    b.hang = "abort";
    sync.progress("song", { best: 1 } as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.calls).toEqual(["upsert progress"]);
    sync.progress("song", { best: 2 } as never);
    await vi.advanceTimersByTimeAsync(10000);
    // The newer change waits for the request already under way.
    expect(b.calls).toEqual(["upsert progress"]);
    b.hang = "no";
    // The first request is aborted 30 s after it started, at 32 s.
    await vi.advanceTimersByTimeAsync(19999);
    expect(b.calls).toEqual(["upsert progress"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.calls).toEqual(["upsert progress", "upsert progress"]);
    expect(b.upserts).toEqual([
      ["progress", [{ user_id: USER, song_id: "song", data: { best: 2 } }]],
    ]);
  });

  it("keeps a removed song's progress removed while an upload is under way", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    b.hang = "manual";
    sync.progress("gone", { best: 1 } as never);
    await vi.advanceTimersByTimeAsync(2000);
    sync.forgetProgress("gone");
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.calls).toEqual(["upsert progress"]);
    expect(unsynced().deleted).toEqual(["gone"]);
    b.hang = "no";
    b.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.calls).toEqual(["upsert progress", "delete progress gone"]);
    expect(sync.pending).toBe(false);
    expect(unsynced()).toEqual({ settings: false, progress: [], deleted: [] });
  });

  it("signs out only once Supabase confirms it", async () => {
    const b = backend();
    write("owner", USER);
    const api = client(b);
    const sync = new CloudSync(api, USER);
    b.signOutError = { message: "offline" };
    sync.progress("song", { best: 1 } as never);
    await expect(sync.signOut()).rejects.toBeTruthy();
    expect(clearAccountData).not.toHaveBeenCalled();
    // Still signed in, so still syncing.
    sync.progress("song", { best: 2 } as never);
    expect(sync.pending).toBe(true);

    b.signOutError = null;
    await sync.signOut();
    expect(b.upserts.at(-1)?.[1]).toEqual([
      { user_id: USER, song_id: "song", data: { best: 2 } },
    ]);
    expect(clearAccountData).toHaveBeenCalledOnce();
    // Other devices keep their sessions.
    expect(api.auth.signOut).toHaveBeenLastCalledWith({ scope: "local" });
    const sent = b.calls.length;
    sync.progress("song", { best: 3 } as never);
    await vi.advanceTimersByTimeAsync(20000);
    expect(b.calls).toHaveLength(sent);
  });

  it("waits for Supabase's answer however long sign-out takes", async () => {
    const b = backend();
    write("owner", USER);
    b.signOutDelay = 45000;
    const sync = new CloudSync(client(b), USER);
    const done = vi.fn();
    const signing = sync.signOut().then(done);
    await vi.advanceTimersByTimeAsync(30000);
    // A time limit here would report failure, then sign out anyway.
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15000);
    await signing;
    expect(done).toHaveBeenCalledOnce();
    expect(clearAccountData).toHaveBeenCalledOnce();
  });

  it("signs out of a failed sign-in without losing earlier unsent changes", async () => {
    const b = backend();
    write("owner", USER);
    write("progress:song", { best: 7 });
    write("unsynced", { progress: ["song"] });
    b.failReads = true;
    const sync = new CloudSync(client(b), USER);
    await expect(sync.pull()).rejects.toBeTruthy();
    await sync.signOut();
    expect(clearAccountData).not.toHaveBeenCalled();
    expect(read("progress:song", null)).toEqual({ best: 7 });

    // Nothing unsent, but this account never finished a pull here: what the
    // browser held before stays for that first sign-in to adopt.
    stored.clear();
    write("progress:song", { best: 3 });
    await new CloudSync(client(b), USER).signOut();
    expect(clearAccountData).not.toHaveBeenCalled();
  });

  it("holds a new sync's uploads until the replaced sync's request settles", async () => {
    const b = backend();
    const old = new CloudSync(client(b), USER);
    b.hang = "manual";
    old.progress("song", { best: 1 } as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.calls).toEqual(["upsert progress"]);
    // Signed out elsewhere and back in while the old request is under way.
    old.stop();
    const release = b.release;
    b.hang = "no";
    const next = new CloudSync(client(b), USER);
    next.progress("song", { best: 2 } as never);
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.calls).toEqual(["upsert progress"]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.calls).toEqual(["upsert progress", "upsert progress"]);
    // The newer progress lands last.
    expect(b.upserts.at(-1)?.[1]).toEqual([
      { user_id: USER, song_id: "song", data: { best: 2 } },
    ]);
  });

  it("keeps unsent changes on the browser when signing out offline", async () => {
    const b = backend();
    b.failWrites = true;
    const sync = new CloudSync(client(b), USER);
    sync.progress("song", { best: 1 } as never);
    await sync.signOut();
    expect(clearAccountData).not.toHaveBeenCalled();
    expect(unsynced().progress).toEqual(["song"]);
  });

  it("marks the browser as the account's only after a successful pull", async () => {
    const b = backend();
    write("progress:only-here", { best: 4 });
    b.failReads = true;
    await expect(new CloudSync(client(b), USER).pull()).rejects.toBeTruthy();
    expect(read("owner", null)).toBeNull();
    expect(read("progress:only-here", {})).toEqual({ best: 4 });
    // The retry still adopts this browser's earlier progress.
    b.failReads = false;
    await new CloudSync(client(b), USER).pull();
    await vi.advanceTimersByTimeAsync(0);
    expect(read("owner", "")).toBe(USER);
    expect(b.upserts).toEqual([
      [
        "progress",
        [{ user_id: USER, song_id: "only-here", data: { best: 4 } }],
      ],
    ]);
  });

  it("changes nothing when a newer sign-in replaces one still loading", async () => {
    const b = backend();
    write("settings", { mode: "listen" });
    b.settings = [{ data: { mode: "rhythm" } }];
    let open!: () => void;
    b.readGate = new Promise((resolve) => (open = resolve));
    const sync = new CloudSync(client(b), USER);
    const pull = sync.pull();
    sync.stop();
    open();
    await expect(pull).rejects.toThrow(/replaced/);
    expect(read("settings", {})).toEqual({ mode: "listen" });
    expect(read("owner", null)).toBeNull();
  });

  it("reads every page of progress before deciding what the account lacks", async () => {
    const b = backend();
    write("owner", USER);
    b.progress = Array.from({ length: 2500 }, (_, i) => ({
      song_id: `song-${String(i).padStart(4, "0")}`,
      data: { best: i % 100 },
    }));
    write("progress:song-2400", { best: 1 });
    await new CloudSync(client(b), USER).pull();
    expect(read("progress:song-2400", {})).toEqual({ best: 0 });
    expect(read("progress:song-0001", {})).toEqual({ best: 1 });
    expect(
      [...stored.keys()].filter((key) => key.startsWith("cadence:progress:")),
    ).toHaveLength(2500);
  });

  it("sends nothing more once stopped", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    sync.progress("song", { best: 1 } as never);
    sync.stop();
    sync.progress("song", { best: 2 } as never);
    await vi.advanceTimersByTimeAsync(20000);
    expect(b.calls).toEqual([]);
  });
});
