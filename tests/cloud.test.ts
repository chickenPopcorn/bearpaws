import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BrowserStorageError,
  CloudSync,
  UnsentChangesError,
} from "../src/cloud";
import { clearAccountData, read, write } from "../src/storage";

vi.mock("../src/storage", async (importActual) => {
  const actual = await importActual<typeof import("../src/storage")>();
  return { ...actual, clearAccountData: vi.fn(actual.clearAccountData) };
});

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

interface Backend {
  settings: { data: unknown }[];
  progress: { song_id: string; data: unknown }[];
  upserts: [string, unknown][];
  calls: string[];
  failWrites: boolean;
  /** Writes to reject, by label, such as "upsert settings". */
  failLabels: string[];
  /** Songs the account has no room for, as the progress_quota trigger refuses. */
  overQuota: string[];
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
    failLabels: [],
    overQuota: [],
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
  const write = (label: string, upsert: [string, unknown]) => ({
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
            b.upserts.push(upsert);
            resolve(reply(null));
          };
        });
      const rows = Array.isArray(upsert[1]) ? upsert[1] : [];
      if (
        rows.some((row: { song_id: string }) =>
          b.overQuota.includes(row.song_id),
        )
      )
        return Promise.resolve(
          reply(null, { code: "23514", message: "limit reached" }),
        );
      const fails = b.failWrites || b.failLabels.includes(label);
      if (!fails) b.upserts.push(upsert);
      return Promise.resolve(
        reply(null, fails ? { message: "offline" } : null),
      );
    },
  });
  const fake = {
    from: (table: "settings" | "progress") => ({
      select: () => ({
        maybeSingle: async () => {
          b.calls.push(`read ${table}`);
          await b.readGate;
          return b.failReads
            ? reply(null, { message: "offline" })
            : reply(b[table][0] ?? null);
        },
        in: async (_column: "song_id", ids: string[]) => {
          b.calls.push(`read ${table}`);
          await b.readGate;
          return reply(
            (b[table] as { song_id: string }[]).filter((row) =>
              ids.includes(row.song_id),
            ),
          );
        },
        order: (column: "song_id") => {
          let after: string | undefined;
          let count = Infinity;
          const query = {
            gt: (_column: string, value: string) => ((after = value), query),
            limit: (n: number) => ((count = n), query),
            then: (
              resolve: (value: unknown) => unknown,
              reject: (error: unknown) => unknown,
            ) =>
              (async () => {
                b.calls.push(`read ${table}`);
                await b.readGate;
                const rows = [...(b[table] as { song_id: string }[])]
                  .sort((x, y) => (x[column] < y[column] ? -1 : 1))
                  .filter((row) => after === undefined || row[column] > after);
                return reply(rows.slice(0, count));
              })().then(resolve, reject),
          };
          return query;
        },
      }),
      upsert: (rows: unknown) => write(`upsert ${table}`, [table, rows]),
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

/** The upload queue in browser storage. */
const queue = () =>
  read<{
    owner?: string;
    settings?: unknown;
    progress?: Record<string, unknown>;
  } | null>("pending", null);
const queued = () => Object.keys(queue()?.progress ?? {});

describe("loading the account", () => {
  it("takes the account's settings and progress, and drops songs it lacks", async () => {
    const b = backend();
    write("owner", USER);
    write("settings", { mode: "listen" });
    write("progress:song", { best: 1 });
    write("progress:gone", { best: 2 });
    b.settings = [{ data: { mode: "wait" } }];
    b.progress = [{ song_id: "song", data: { best: 7 } }];
    await new CloudSync(client(b), USER).pull();
    expect(read("settings", null)).toEqual({ mode: "wait" });
    expect(read("progress:song", null)).toEqual({ best: 7 });
    expect(read("progress:gone", null)).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.upserts).toEqual([]);
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

  it("adopts again after a first pull that could not save its queue", async () => {
    const b = backend();
    write("progress:only-here", { best: 4 });
    refusedKey = "cadence:pending";
    await expect(new CloudSync(client(b), USER).pull()).rejects.toBeInstanceOf(
      BrowserStorageError,
    );
    // Not yet the owner, so the retry still adopts this browser's progress.
    expect(read("owner", null)).toBeNull();
    refusedKey = "";
    await new CloudSync(client(b), USER).pull();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.upserts).toEqual([
      [
        "progress",
        [{ user_id: USER, song_id: "only-here", data: { best: 4 } }],
      ],
    ]);
  });

  it("clears another account's data, its unsent changes included", async () => {
    const b = backend();
    write("owner", OTHER);
    write("progress:theirs", { best: 1 });
    write("pending", { owner: OTHER, progress: { theirs: { best: 1 } } });
    await new CloudSync(client(b), USER).pull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(clearAccountData).toHaveBeenCalledOnce();
    expect(read("progress:theirs", null)).toBeNull();
    expect(queue()).toBeNull();
    expect(b.upserts).toEqual([]);
    expect(read("owner", "")).toBe(USER);
  });

  it("first uploads what an earlier visit left waiting", async () => {
    const b = backend();
    write("owner", USER);
    write("pending", { owner: USER, progress: { song: { best: 5 } } });
    b.progress = [{ song_id: "song", data: { best: 3 } }];
    const sync = new CloudSync(client(b), USER);
    expect(sync.pending).toBe(true);
    await sync.pull();
    // The server merges the upload, so the account's copy then includes it.
    expect(b.calls.slice(0, 2)).toEqual(["upsert progress", "read settings"]);
    expect(queue()).toBeNull();
  });

  it("does not open while what was left waiting cannot upload", async () => {
    const b = backend();
    write("owner", USER);
    write("pending", { owner: USER, progress: { song: { best: 5 } } });
    b.failWrites = true;
    const sync = new CloudSync(client(b), USER);
    await expect(sync.pull()).rejects.toThrow(/could not be saved/);
    sync.stop();
    expect(queued()).toEqual(["song"]);
  });

  it("reads every page of progress", async () => {
    const b = backend();
    write("owner", USER);
    b.progress = Array.from({ length: 2500 }, (_, i) => ({
      song_id: `song-${String(i).padStart(4, "0")}`,
      data: { best: i % 100 },
    }));
    await new CloudSync(client(b), USER).pull();
    expect(read("progress:song-2499", {})).toEqual({ best: 99 });
    expect(
      [...stored.keys()].filter((key) => key.startsWith("cadence:progress:")),
    ).toHaveLength(2500);
  });

  it("checks a song added behind a long scan before dropping its copy", async () => {
    const b = backend();
    write("owner", USER);
    b.progress = Array.from({ length: 2500 }, (_, i) => ({
      song_id: `song-${String(i).padStart(4, "0")}`,
      data: { best: 1 },
    }));
    write("progress:song-0500a", { best: 3 });
    const api = client(b);
    const from = api.from;
    let reads = 0;
    api.from = ((table: "progress") => {
      // Another device adds the song behind the scan.
      if (table === "progress" && ++reads === 2)
        b.progress.push({ song_id: "song-0500a", data: { best: 6 } });
      return from(table);
    }) as never;
    await new CloudSync(api, USER).pull();
    expect(read("progress:song-0500a", null)).toEqual({ best: 6 });
  });

  it("refuses to open when this browser cannot store the account's data", async () => {
    const b = backend();
    b.settings = [{ data: { mode: "wait" } }];
    storageBlocked = true;
    await expect(new CloudSync(client(b), USER).pull()).rejects.toBeInstanceOf(
      BrowserStorageError,
    );
  });

  it("gives up on a request that does not answer", async () => {
    const api = client(backend());
    const hang = {
      gt: () => hang,
      limit: () => hang,
      then: () => new Promise(() => {}),
    };
    api.from = (() => ({
      select: () => ({
        maybeSingle: () => new Promise(() => {}),
        order: () => hang,
      }),
    })) as never;
    const pull = new CloudSync(api, USER).pull();
    const failure = expect(pull).rejects.toThrow(/did not respond/);
    await vi.advanceTimersByTimeAsync(30000);
    await failure;
  });

  it("changes nothing when a newer sign-in replaces one still loading", async () => {
    const b = backend();
    let open!: () => void;
    b.readGate = new Promise((resolve) => (open = resolve));
    b.settings = [{ data: { mode: "wait" } }];
    const sync = new CloudSync(client(b), USER);
    const pulling = sync.pull();
    sync.stop();
    open();
    await expect(pulling).rejects.toThrow(/replaced/);
    expect(read("settings", null)).toBeNull();
    expect(read("owner", null)).toBeNull();
  });
});

describe("uploading changes", () => {
  it("uploads a burst once, keeps it queued until confirmed, and retries a failure", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    const onChange = vi.fn();
    sync.onChange = onChange;
    sync.settings({ mode: "wait" } as never);
    sync.progress("song", { best: 1 } as never);
    sync.progress("song", { best: 2 } as never);
    expect(queued()).toEqual(["song"]);
    await vi.advanceTimersByTimeAsync(1999);
    expect(b.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.calls).toEqual(["upsert settings", "upsert progress"]);
    expect(b.upserts[1][1]).toEqual([
      { user_id: USER, song_id: "song", data: { best: 2 } },
    ]);
    expect(queue()).toBeNull();

    b.failWrites = true;
    sync.progress("song", { best: 3 } as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.error).toMatch(/Retrying/);
    expect(queued()).toEqual(["song"]);
    expect(onChange).toHaveBeenCalled();
    b.failWrites = false;
    await vi.advanceTimersByTimeAsync(15000);
    expect(sync.error).toBe("");
    expect(sync.pending).toBe(false);
    expect(b.upserts.at(-1)?.[1]).toEqual([
      { user_id: USER, song_id: "song", data: { best: 3 } },
    ]);
  });

  it("retries only the request that failed", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    b.failLabels = ["upsert settings"];
    sync.settings({ mode: "wait" } as never);
    sync.progress("song", { best: 1 } as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(queue()).toMatchObject({ settings: { mode: "wait" }, progress: {} });
    b.failLabels = [];
    await vi.advanceTimersByTimeAsync(15000);
    expect(b.calls).toEqual([
      "upsert settings",
      "upsert progress",
      "upsert settings",
    ]);
    expect(queue()).toBeNull();
  });

  it("keeps a save made during an upload queued, even one back to the account's copy", async () => {
    const b = backend();
    write("owner", USER);
    b.progress = [{ song_id: "song", data: { best: 1 } }];
    const sync = new CloudSync(client(b), USER);
    await sync.pull();
    b.hang = "manual";
    sync.progress("song", { best: 2 } as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.calls.at(-1)).toBe("upsert progress");
    sync.progress("song", { best: 1 } as never);
    b.hang = "no";
    b.release();
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.upserts.at(-1)?.[1]).toEqual([
      { user_id: USER, song_id: "song", data: { best: 1 } },
    ]);
    expect(queue()).toBeNull();
  });

  it("sends nothing for saves that match the account, or a song as it opens", async () => {
    const b = backend();
    write("owner", USER);
    b.settings = [{ data: { mode: "wait", speed: 1 } }];
    b.progress = [{ song_id: "song", data: { best: 1, updated: "a" } }];
    const sync = new CloudSync(client(b), USER);
    await sync.pull();
    sync.settings({ speed: 1, mode: "wait" } as never);
    sync.progress("song", { updated: "b", best: 1 } as never);
    sync.progress("new", { best: 0 } as never, true);
    sync.progress("new", { best: 0 } as never);
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.calls.filter((call) => call.startsWith("upsert"))).toEqual([]);
    sync.progress("new", { best: 3 } as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.calls.at(-1)).toBe("upsert progress");
  });

  it("drops new songs a full account refuses, and still saves the songs it has", async () => {
    const b = backend();
    write("owner", USER);
    b.progress = [{ song_id: "known", data: { best: 1 } }];
    const sync = new CloudSync(client(b), USER);
    await sync.pull();
    b.overQuota = ["new"];
    sync.progress("known", { best: 2 } as never);
    sync.progress("new", { best: 1 } as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.error).toMatch(/200 songs/);
    // The retry starts at once (a timer set during a tick runs 1 ms later).
    await vi.advanceTimersByTimeAsync(1);
    expect(b.upserts.at(-1)?.[1]).toEqual([
      { user_id: USER, song_id: "known", data: { best: 2 } },
    ]);
    expect(queue()).toBeNull();
  });

  it("adopts only as many songs as the account has room for", async () => {
    const b = backend();
    for (let i = 0; i < 205; i++)
      write(`progress:song-${String(i).padStart(3, "0")}`, { best: 1 });
    const sync = new CloudSync(client(b), USER);
    sync.flush = async () => {};
    await sync.pull();
    expect(queued()).toHaveLength(200);
  });

  it("uploads at once and says so when storage cannot hold the queue", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    refusedKey = "cadence:pending";
    sync.progress("song", { best: 1 } as never);
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

  it("keeps the queue across a reload, for the same account only", () => {
    const sync = new CloudSync(client(backend()), USER);
    sync.progress("song", { best: 1 } as never);
    sync.stop();
    expect(new CloudSync(client(backend()), USER).pending).toBe(true);
    expect(new CloudSync(client(backend()), OTHER).pending).toBe(false);
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

describe("signing out", () => {
  it("uploads what is waiting, signs this browser out, and clears its copy", async () => {
    const b = backend();
    write("owner", USER);
    write("settings", { mode: "wait" });
    write("practice:session-1", { seconds: 300 });
    const api = client(b);
    const sync = new CloudSync(api, USER);
    sync.progress("song", { best: 2 } as never);
    await sync.signOut();
    expect(b.upserts).toEqual([
      ["progress", [{ user_id: USER, song_id: "song", data: { best: 2 } }]],
    ]);
    // Other devices keep their sessions.
    expect(api.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(clearAccountData).toHaveBeenCalledOnce();
    expect(queue()).toBeNull();
    expect(read("settings", null)).toBeNull();
    expect(read("owner", null)).toBeNull();
    // Practice time is this browser's, not the account's: the calendar keeps it.
    expect(read("practice:session-1", null)).toEqual({ seconds: 300 });
  });

  it("asks before dropping practice that could not upload", async () => {
    const b = backend();
    const api = client(b);
    const sync = new CloudSync(api, USER);
    b.failWrites = true;
    sync.progress("song", { best: 2 } as never);
    await expect(sync.signOut()).rejects.toBeInstanceOf(UnsentChangesError);
    // Still signed in, and still syncing.
    expect(api.auth.signOut).not.toHaveBeenCalled();
    expect(sync.pending).toBe(true);
    const uploads = b.calls.length;
    await sync.signOut({ force: true });
    // No second wait on an upload that just failed.
    expect(b.calls).toHaveLength(uploads);
    expect(api.auth.signOut).toHaveBeenCalledOnce();
    expect(queue()).toBeNull();
  });

  it("stays signed in when Supabase cannot end the session", async () => {
    const b = backend();
    b.signOutError = { message: "offline" };
    const sync = new CloudSync(client(b), USER);
    await expect(sync.signOut()).rejects.toEqual({ message: "offline" });
    expect(clearAccountData).not.toHaveBeenCalled();
    sync.progress("song", { best: 1 } as never);
    expect(sync.pending).toBe(true);
  });

  it("waits for Supabase's answer however long sign-out takes", async () => {
    const b = backend();
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
});
