import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BrowserStorageError,
  CloudSync,
  UnsentChangesError,
} from "../src/cloud";
import { localDay } from "../src/practiceLog";
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
  practice_sessions: { id: string; day: string; [key: string]: unknown }[];
  upserts: [string, unknown][];
  calls: string[];
  failWrites: boolean;
  /** Writes to reject, by label, such as "upsert settings". */
  failLabels: string[];
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
    practice_sessions: [],
    upserts: [],
    calls: [],
    failWrites: false,
    failLabels: [],
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
      const fails = b.failWrites || b.failLabels.includes(label);
      if (!fails) b.upserts.push(upsert);
      return Promise.resolve(
        reply(null, fails ? { message: "offline" } : null),
      );
    },
  });
  /** A read of `rows` that sorts and pages by `column`, as the Data API does. */
  const ordered =
    (table: string, rows: () => Record<string, unknown>[]) =>
    (column: string) => {
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
            const key = (row: Record<string, unknown>) => String(row[column]);
            const sorted = [...rows()]
              .sort((x, y) => (key(x) < key(y) ? -1 : 1))
              .filter((row) => after === undefined || key(row) > after);
            return reply(sorted.slice(0, count));
          })().then(resolve, reject),
      };
      return query;
    };
  const fake = {
    from: (table: "settings" | "progress" | "practice_sessions") => ({
      select: () => ({
        maybeSingle: async () => {
          b.calls.push(`read ${table}`);
          await b.readGate;
          return b.failReads
            ? reply(null, { message: "offline" })
            : reply(b[table][0] ?? null);
        },
        order: ordered(table, () => b[table]),
        gte: (_column: "day", since: string) => ({
          order: ordered(table, () =>
            b.practice_sessions.filter((row) => row.day >= since),
          ),
        }),
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
    practice?: Record<string, { seconds: number }>;
  } | null>("pending", null);
const queued = () => Object.keys(queue()?.progress ?? {});
const queuedPractice = () => Object.keys(queue()?.practice ?? {});
/** A practice session `seconds` long, today. */
const session = (id: string, seconds: number) => ({
  id,
  day: localDay(new Date()),
  startedAt: "2026-10-18T10:00:00.000Z",
  seconds,
  songs: { ode: seconds },
});

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
        gte: () => ({ order: () => hang }),
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
    await sync.signOut({ force: true });
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

describe("practice time", () => {
  it("loads the last 92 days of the account's sessions", async () => {
    const b = backend();
    write("owner", USER);
    b.practice_sessions = [
      { ...session("a", 200), started_at: "x" },
      { ...session("old", 900), day: "2000-01-01", started_at: "x" },
    ];
    write("practice", [session("gone", 30)]);
    await new CloudSync(client(b), USER).pull();
    // "gone" is not in the account, so it is not this account's.
    expect(
      read<{ id: string; seconds: number }[]>("practice", []).map((s) => [
        s.id,
        s.seconds,
      ]),
    ).toEqual([["a", 200]]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.upserts).toEqual([]);
  });

  it("sends this browser's copy of a session again where it has more time", async () => {
    const b = backend();
    write("owner", USER);
    b.practice_sessions = [{ ...session("s1", 60), started_at: "x" }];
    write("practice", [session("s1", 90)]);
    await new CloudSync(client(b), USER).pull();
    expect(read<{ seconds: number }[]>("practice", [])[0].seconds).toBe(90);
    await vi.advanceTimersByTimeAsync(0);
    expect(b.upserts).toEqual([
      [
        "practice_sessions",
        [expect.objectContaining({ id: "s1", user_id: USER, seconds: 90 })],
      ],
    ]);
  });

  it("adopts this browser's sessions where a new account has none", async () => {
    const b = backend();
    write("practice", [session("here", 40)]);
    await new CloudSync(client(b), USER).pull();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.upserts).toEqual([
      [
        "practice_sessions",
        [expect.objectContaining({ id: "here", user_id: USER, seconds: 40 })],
      ],
    ]);
  });

  it("uploads a session's running total under its own id", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    sync.practice(session("s1", 90));
    sync.practice(session("s1", 120));
    expect(queuedPractice()).toEqual(["s1"]);
    await vi.advanceTimersByTimeAsync(2000);
    // Re-sending a session's total replaces it, never adds to it.
    expect(b.upserts).toEqual([
      [
        "practice_sessions",
        [
          {
            id: "s1",
            user_id: USER,
            day: localDay(new Date()),
            started_at: "2026-10-18T10:00:00.000Z",
            seconds: 120,
            songs: { ode: 120 },
          },
        ],
      ],
    ]);
    expect(queue()).toBeNull();
  });

  it("keeps a session queued that grew while its upload was under way", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    b.hang = "manual";
    sync.practice(session("s1", 30));
    await vi.advanceTimersByTimeAsync(2000);
    sync.practice(session("s1", 45));
    b.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue()?.practice?.s1.seconds).toBe(45);
    b.hang = "no";
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.upserts.at(-1)?.[1]).toEqual([
      expect.objectContaining({ id: "s1", seconds: 45 }),
    ]);
    expect(queue()).toBeNull();
  });

  it("retries a failed practice upload on its own", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    b.failLabels = ["upsert practice_sessions"];
    sync.progress("song", { best: 1 } as never);
    sync.practice(session("s1", 30));
    await vi.advanceTimersByTimeAsync(2000);
    expect(queued()).toEqual([]);
    expect(queuedPractice()).toEqual(["s1"]);
    expect(sync.error).toMatch(/Retrying/);
    b.failLabels = [];
    await vi.advanceTimersByTimeAsync(15000);
    // The progress landed, so only the practice goes again.
    expect(b.calls).toEqual([
      "upsert progress",
      "upsert practice_sessions",
      "upsert practice_sessions",
    ]);
    expect(sync.pending).toBe(false);
  });

  it("reads a queue an earlier build left, which has no practice", () => {
    write("pending", { owner: USER, progress: { song: { best: 5 } } });
    const sync = new CloudSync(client(backend()), USER);
    expect(sync.pending).toBe(true);
    sync.practice(session("s1", 30));
    expect(queuedPractice()).toEqual(["s1"]);
    sync.stop();
  });

  it("asks before signing out with practice that could not upload", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    b.failWrites = true;
    sync.practice(session("s1", 30));
    await expect(sync.signOut()).rejects.toBeInstanceOf(UnsentChangesError);
    expect(queuedPractice()).toEqual(["s1"]);
  });
});
