import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BrowserStorageError, CloudSync } from "../src/cloud";
import { localDay } from "../src/practiceLog";
import { clearAccountData, read, write } from "../src/storage";

vi.mock("../src/storage", async (importActual) => {
  const actual = await importActual<typeof import("../src/storage")>();
  return { ...actual, clearAccountData: vi.fn(actual.clearAccountData) };
});

const USER = "11111111-1111-1111-1111-111111111111";

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
      const fails = b.failWrites || b.failLabels.includes(label);
      if (upsert && !fails) b.upserts.push(upsert);
      return Promise.resolve(
        reply(null, fails ? { message: "offline" } : null),
      );
    },
  });
  /** A query that sorts and pages by `column`, as the Data API does. */
  const ordered =
    (rows: () => Record<string, unknown>[]) => (column: string) => {
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
          await b.readGate;
          return b.failReads
            ? reply(null, { message: "offline" })
            : reply(b[table][0] ?? null);
        },
        order: ordered(() => b[table]),
        gte: (_column: "day", since: string) => ({
          order: ordered(() =>
            b.practice_sessions.filter((row) => row.day >= since),
          ),
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
/** Runs after each read of browser storage, as another tab might write. */
let afterGet: ((key: string) => void) | null = null;
beforeEach(() => {
  stored.clear();
  storageBlocked = false;
  refusedKey = "";
  afterGet = null;
  vi.stubGlobal("localStorage", {
    get length() {
      return stored.size;
    },
    key: (i: number) => [...stored.keys()][i] ?? null,
    getItem: (key: string) => {
      const value = stored.get(key) ?? null;
      afterGet?.(key);
      return value;
    },
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

/** The stored marker: which settings, songs and sessions are unconfirmed. */
const marker = () =>
  read<{
    settings?: string;
    progress?: Record<string, string>;
    deleted?: Record<string, string>;
    practice?: Record<string, string>;
  }>("unsynced", {});
const unsynced = () => {
  const stored = marker();
  return {
    settings: !!stored.settings,
    progress: Object.keys(stored.progress ?? {}),
    deleted: Object.keys(stored.deleted ?? {}),
    practice: Object.keys(stored.practice ?? {}),
  };
};

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
    expect(unsynced()).toEqual({
      settings: false,
      progress: [],
      deleted: [],
      practice: [],
    });
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

  it("retries only the requests that failed", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    b.failLabels = ["upsert settings"];
    sync.settings({ mode: "wait" } as never);
    sync.progress("song", { best: 1 } as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.upserts).toEqual([
      ["progress", [{ user_id: USER, song_id: "song", data: { best: 1 } }]],
    ]);
    expect(unsynced()).toMatchObject({ settings: true, progress: [] });
    b.failLabels = [];
    await vi.advanceTimersByTimeAsync(15000);
    // The landed progress is not sent again, where it could overwrite newer
    // practice from another device.
    expect(b.calls).toEqual([
      "upsert settings",
      "upsert progress",
      "upsert settings",
    ]);
    expect(unsynced()).toMatchObject({ settings: false, progress: [] });
  });

  it("uploads at once a session the browser could not store", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    const session = {
      id: "s1",
      day: "2026-10-18",
      startedAt: "2026-10-18T10:00:00.000Z",
      seconds: 30,
      songs: { song: 30 },
    };
    sync.practice(session, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(b.calls).toEqual([]);
    sync.practice({ ...session, seconds: 31 }, false);
    await vi.advanceTimersByTimeAsync(0);
    expect(b.calls).toEqual(["upsert practice_sessions"]);
  });

  it("retries a failed practice upload on its own", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    b.failLabels = ["upsert practice_sessions"];
    sync.progress("song", { best: 1 } as never);
    sync.practice(
      {
        id: "s1",
        day: "2026-10-18",
        startedAt: "2026-10-18T10:00:00.000Z",
        seconds: 30,
        songs: { song: 30 },
      },
      true,
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(unsynced()).toMatchObject({ progress: [], practice: ["s1"] });
    b.failLabels = [];
    await vi.advanceTimersByTimeAsync(15000);
    expect(b.calls).toEqual([
      "upsert progress",
      "upsert practice_sessions",
      "upsert practice_sessions",
    ]);
    expect(unsynced()).toMatchObject({ progress: [], practice: [] });
  });

  it("keeps changes another tab saves while sign-in loads", async () => {
    const b = backend();
    write("owner", USER);
    let open!: () => void;
    b.readGate = new Promise((resolve) => (open = resolve));
    b.progress = [{ song_id: "song", data: { best: 1 } }];
    const pulling = new CloudSync(client(b), USER).pull();
    // Another tab of this account saves while the reads are under way.
    write("progress:song", { best: 9 });
    write("unsynced", { progress: ["song"] });
    open();
    await pulling;
    expect(read("progress:song", null)).toEqual({ best: 9 });
    await vi.advanceTimersByTimeAsync(0);
    expect(b.upserts).toEqual([
      ["progress", [{ user_id: USER, song_id: "song", data: { best: 9 } }]],
    ]);
  });

  it("keeps another tab's newer save of a song when an older upload lands", async () => {
    const b = backend();
    const tabA = new CloudSync(client(b), USER);
    const tabB = new CloudSync(client(b), USER);
    const older = "2026-10-19T01:00:00.000Z",
      newer = "2026-10-19T01:00:05.000Z";
    b.hang = "manual";
    tabA.progress("song", { best: 1, updated: older } as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.calls).toEqual(["upsert progress"]);
    tabB.progress("song", { best: 2, updated: newer } as never);
    expect(marker().progress).toEqual({ song: newer });
    b.hang = "no";
    b.release();
    await vi.advanceTimersByTimeAsync(0);
    // Tab A confirmed only its older save.
    expect(marker().progress).toEqual({ song: newer });
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.upserts.at(-1)?.[1]).toEqual([
      { user_id: USER, song_id: "song", data: { best: 2, updated: newer } },
    ]);
    expect(marker().progress).toEqual({});
    tabA.stop();
    tabB.stop();
  });

  it("lets a save in one tab supersede an earlier removal in another", async () => {
    const b = backend();
    write("owner", USER);
    const tabA = new CloudSync(client(b), USER);
    const tabB = new CloudSync(client(b), USER);
    b.failWrites = true;
    vi.setSystemTime(new Date("2026-10-19T01:00:00.000Z"));
    tabA.forgetProgress("song");
    await vi.advanceTimersByTimeAsync(2000);
    expect(unsynced().deleted).toEqual(["song"]);
    // Tab B still had the song open, and saves it afterwards.
    const later = "2026-10-19T01:00:05.000Z";
    write("progress:song", { best: 6, updated: later });
    tabB.progress("song", { best: 6, updated: later } as never);
    expect(unsynced()).toMatchObject({ progress: ["song"], deleted: [] });
    tabA.stop();
    tabB.stop();
    // After a reload, only the save is sent: the one delete is tab A's
    // earlier failed attempt.
    b.failWrites = false;
    await new CloudSync(client(b), USER).pull();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.calls.filter((call) => call.startsWith("delete"))).toEqual([
      "delete progress song",
    ]);
    expect(b.calls.at(-1)).toBe("upsert progress");
    expect(b.upserts.at(-1)?.[1]).toEqual([
      { user_id: USER, song_id: "song", data: { best: 6, updated: later } },
    ]);
  });

  it("keeps another tab's unconfirmed changes in the shared marker", async () => {
    const b = backend();
    const tabA = new CloudSync(client(b), USER);
    const tabB = new CloudSync(client(b), USER);
    const session = (id: string) => ({
      id,
      day: "2026-10-18",
      startedAt: "2026-10-18T10:00:00.000Z",
      seconds: 30,
      songs: { ode: 30 },
    });
    b.failWrites = true;
    tabA.progress("a", { best: 1 } as never);
    tabA.practice(session("pa"), true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(unsynced()).toMatchObject({ progress: ["a"], practice: ["pa"] });
    b.failWrites = false;
    tabB.progress("b", { best: 2 } as never);
    tabB.practice(session("pb"), true);
    expect(unsynced()).toMatchObject({
      progress: ["a", "b"],
      practice: ["pa", "pb"],
    });
    // Tab B's upload confirms only its own changes.
    await tabB.flush();
    expect(unsynced()).toMatchObject({ progress: ["a"], practice: ["pa"] });
    await vi.advanceTimersByTimeAsync(15000);
    expect(unsynced()).toMatchObject({ progress: [], practice: [] });
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

  it("keeps another account's unsent changes for its next sign-in here", async () => {
    const OTHER = "22222222-2222-2222-2222-222222222222";
    write("owner", OTHER);
    write("progress:theirs", { best: 5, updated: "t" });
    write("unsynced", { progress: { theirs: "t" }, deleted: {} });
    const b = backend();
    await new CloudSync(client(b), USER).pull();
    // Not this account's to see or upload.
    expect(read("progress:theirs", null)).toBeNull();
    expect(unsynced().progress).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(b.upserts).toEqual([]);
    // The other account signs back in and uploads it.
    await new CloudSync(client(b), OTHER).pull();
    expect(read("progress:theirs", null)).toEqual({ best: 5, updated: "t" });
    await vi.advanceTimersByTimeAsync(0);
    expect(b.upserts).toEqual([
      [
        "progress",
        [
          {
            user_id: OTHER,
            song_id: "theirs",
            data: { best: 5, updated: "t" },
          },
        ],
      ],
    ]);
    expect(read(`stash:${OTHER}`, null)).toBeNull();
  });

  it("keeps another account's unsent practice for its next sign-in here", async () => {
    const OTHER = "22222222-2222-2222-2222-222222222222";
    const today = localDay(new Date());
    const session = (id: string) => ({
      id,
      day: today,
      startedAt: "x",
      seconds: 40,
      songs: { ode: 40 },
    });
    write("owner", OTHER);
    write("practice", [session("unsent"), session("uploaded")]);
    write("unsynced", {
      progress: {},
      deleted: {},
      practice: { unsent: "000040" },
    });
    const b = backend();
    await new CloudSync(client(b), USER).pull();
    // Not this account's to see or upload.
    expect(read("practice", [])).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(b.upserts).toEqual([]);
    // The other account signs back in and uploads it.
    await new CloudSync(client(b), OTHER).pull();
    expect(read("practice", [])).toEqual([session("unsent")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(b.upserts).toEqual([
      [
        "practice_sessions",
        [
          expect.objectContaining({
            id: "unsent",
            user_id: OTHER,
            seconds: 40,
          }),
        ],
      ],
    ]);
    expect(read(`stash:${OTHER}`, null)).toBeNull();
  });

  it("adds unsent practice to an account's earlier stash, the longer copy winning", async () => {
    const OTHER = "22222222-2222-2222-2222-222222222222";
    const today = localDay(new Date());
    const session = (id: string, seconds: number) => ({
      id,
      day: today,
      startedAt: "x",
      seconds,
      songs: { ode: seconds },
    });
    write(`stash:${OTHER}`, {
      marker: {
        owner: OTHER,
        progress: {},
        deleted: {},
        practice: { grew: "000030", kept: "000090" },
      },
      settings: null,
      progress: {},
      practice: [session("grew", 30), session("kept", 90)],
    });
    write("owner", OTHER);
    write("practice", [
      session("grew", 50),
      session("kept", 60),
      session("new", 10),
    ]);
    write("unsynced", {
      owner: OTHER,
      progress: {},
      deleted: {},
      practice: { grew: "000050", kept: "000060", new: "000010" },
    });
    await new CloudSync(client(backend()), USER).pull();
    const stash = read<{
      marker: { practice: Record<string, string> };
      practice: { id: string; seconds: number }[];
    } | null>(`stash:${OTHER}`, null)!;
    expect(stash.practice.map((s) => [s.id, s.seconds])).toEqual([
      ["grew", 50],
      ["kept", 90],
      ["new", 10],
    ]);
    expect(stash.marker.practice).toEqual({
      grew: "000050",
      kept: "000090",
      new: "000010",
    });
  });

  it("keeps a switched-out account's late saves out of the new account", async () => {
    const OTHER = "22222222-2222-2222-2222-222222222222";
    write("owner", OTHER);
    const b = backend();
    let open!: () => void;
    b.readGate = new Promise((resolve) => (open = resolve));
    const pulling = new CloudSync(client(b), USER).pull();
    // A tab of the other account, not yet told of the switch, saves.
    write("progress:theirs", { best: 7, updated: "t" });
    write("settings", { mode: "rhythm" });
    write("unsynced", {
      owner: OTHER,
      settings: "s",
      progress: { theirs: "t" },
      deleted: {},
    });
    open();
    await pulling;
    await vi.advanceTimersByTimeAsync(0);
    expect(b.upserts).toEqual([]);
    expect(read("progress:theirs", null)).toBeNull();
    expect(read("settings", null)).toBeNull();
    expect(
      read<{ progress: Record<string, unknown> }>(`stash:${OTHER}`, {
        progress: {},
      }).progress,
    ).toEqual({ theirs: { best: 7, updated: "t" } });
  });

  it("drops a restored stash even when that pull fails", async () => {
    const OTHER = "22222222-2222-2222-2222-222222222222";
    write(`stash:${USER}`, {
      marker: { progress: { mine: "t" }, deleted: {} },
      settings: null,
      progress: { mine: { best: 4, updated: "t" } },
    });
    write("owner", OTHER);
    const b = backend();
    b.failReads = true;
    await expect(new CloudSync(client(b), USER).pull()).rejects.toBeTruthy();
    // Restored into the working copy, so the stash cannot win again later.
    expect(read(`stash:${USER}`, null)).toBeNull();
    expect(read("progress:mine", null)).toEqual({ best: 4, updated: "t" });
    b.failReads = false;
    await new CloudSync(client(b), USER).pull();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.upserts.at(-1)?.[1]).toEqual([
      { user_id: USER, song_id: "mine", data: { best: 4, updated: "t" } },
    ]);
  });

  it("keeps a save another tab makes while sign-in reconciles", async () => {
    const b = backend();
    write("owner", USER);
    b.progress = [{ song_id: "song", data: { best: 1, updated: "a" } }];
    let reads = 0;
    afterGet = (key) => {
      if (key !== "cadence:unsynced" || ++reads !== 1) return;
      write("progress:song", { best: 9, updated: "b" });
      write("unsynced", { progress: { song: "b" }, deleted: {} });
    };
    await new CloudSync(client(b), USER).pull();
    afterGet = null;
    expect(read("progress:song", null)).toEqual({ best: 9, updated: "b" });
    expect(unsynced().progress).toEqual(["song"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(b.upserts.at(-1)?.[1]).toEqual([
      { user_id: USER, song_id: "song", data: { best: 9, updated: "b" } },
    ]);
  });

  it("keeps a practice session another tab marks while sign-in reconciles", async () => {
    const b = backend();
    write("owner", USER);
    const session = {
      id: "s1",
      day: localDay(new Date()),
      startedAt: "x",
      seconds: 20,
      songs: { ode: 20 },
    };
    let reads = 0;
    afterGet = (key) => {
      if (key !== "cadence:unsynced" || ++reads !== 1) return;
      write("practice", [session]);
      write("unsynced", {
        progress: {},
        deleted: {},
        practice: { s1: "000020" },
      });
    };
    await new CloudSync(client(b), USER).pull();
    afterGet = null;
    expect(read("practice", [])).toEqual([session]);
    await vi.advanceTimersByTimeAsync(0);
    expect(b.upserts).toEqual([
      [
        "practice_sessions",
        [expect.objectContaining({ id: "s1", seconds: 20 })],
      ],
    ]);
  });

  it("uploads the longest stored copy of a queued session", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    const session = {
      id: "s1",
      day: "2026-10-18",
      startedAt: "x",
      seconds: 30,
      songs: { ode: 30 },
    };
    sync.practice(session, true);
    // Another tab saves a longer copy of the session before the upload.
    write("practice", [{ ...session, seconds: 50, songs: { ode: 50 } }]);
    write("unsynced", { ...marker(), practice: { s1: "000050" } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.upserts).toEqual([
      [
        "practice_sessions",
        [expect.objectContaining({ id: "s1", seconds: 50 })],
      ],
    ]);
    expect(unsynced().practice).toEqual([]);
  });

  it("does not take an older record for a save the browser could not store", async () => {
    const b = backend();
    write("owner", USER);
    b.progress = [{ song_id: "song", data: { best: 5, updated: "c" } }];
    write("progress:song", { best: 2, updated: "a" });
    write("unsynced", { progress: { song: "b" }, deleted: {} });
    await new CloudSync(client(b), USER).pull();
    await vi.advanceTimersByTimeAsync(0);
    expect(read("progress:song", null)).toEqual({ best: 5, updated: "c" });
    expect(b.upserts).toEqual([]);
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
      practice: [],
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(b.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.calls).toEqual(["upsert settings", "upsert progress"]);
    expect(b.upserts[1][1]).toEqual([
      { user_id: USER, song_id: "song", data: { best: 2 } },
    ]);
    expect(unsynced()).toEqual({
      settings: false,
      progress: [],
      deleted: [],
      practice: [],
    });

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

  it("uploads practice sessions under their own ids", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    const session = {
      id: "s1",
      day: "2026-10-18",
      startedAt: "2026-10-18T10:00:00.000Z",
      seconds: 90,
      songs: { ode: 90 },
    };
    sync.practice(session, true);
    sync.practice({ ...session, seconds: 120, songs: { ode: 120 } }, true);
    expect(unsynced().practice).toEqual(["s1"]);
    await vi.advanceTimersByTimeAsync(2000);
    // Re-sending a session's running total replaces it, never adds to it.
    expect(b.upserts).toEqual([
      [
        "practice_sessions",
        [
          {
            id: "s1",
            user_id: USER,
            day: "2026-10-18",
            started_at: "2026-10-18T10:00:00.000Z",
            seconds: 120,
            songs: { ode: 120 },
          },
        ],
      ],
    ]);
    expect(unsynced().practice).toEqual([]);
  });

  it("loads recent practice and keeps the larger copy of each session", async () => {
    const b = backend();
    write("owner", USER);
    const today = localDay(new Date());
    b.practice_sessions = [
      { id: "a", day: today, started_at: "x", seconds: 200, songs: {} },
      { id: "b", day: today, started_at: "y", seconds: 50, songs: {} },
      { id: "c", day: today, started_at: "v", seconds: 300, songs: {} },
      { id: "d", day: today, started_at: "u", seconds: 500, songs: {} },
      {
        id: "old",
        day: "2000-01-01",
        started_at: "z",
        seconds: 900,
        songs: {},
      },
    ];
    write("practice", [
      { id: "b", day: today, startedAt: "y", seconds: 80, songs: {} },
      { id: "gone", day: today, startedAt: "w", seconds: 30, songs: {} },
      // Newer here than in the account, though not in the marker.
      { id: "c", day: today, startedAt: "v", seconds: 400, songs: {} },
      // In the marker, but another tab already uploaded a newer copy.
      { id: "d", day: today, startedAt: "u", seconds: 100, songs: {} },
    ]);
    write("unsynced", { practice: ["b", "d"] });
    const sync = new CloudSync(client(b), USER);
    await sync.pull();
    // "gone" was uploaded before and is no longer in the account.
    expect(
      read<{ id: string; seconds: number }[]>("practice", []).map((s) => [
        s.id,
        s.seconds,
      ]),
    ).toEqual([
      ["a", 200],
      ["b", 80],
      ["c", 400],
      ["d", 500],
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(b.upserts).toEqual([
      [
        "practice_sessions",
        [
          expect.objectContaining({ id: "b", seconds: 80 }),
          expect.objectContaining({ id: "c", seconds: 400 }),
        ],
      ],
    ]);
    expect(unsynced().practice).toEqual([]);
  });

  it("takes a song's opening save as its starting point when the account has none", async () => {
    const b = backend();
    write("owner", USER);
    const sync = new CloudSync(client(b), USER);
    await sync.pull();
    // Closing the song untouched must not overwrite practice another device
    // adds meanwhile.
    sync.progress("song", { best: 0, position: 0 } as never, true);
    sync.progress("song", { best: 0, position: 0 } as never);
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.calls).toEqual([]);
    sync.progress("song", { best: 3, position: 0 } as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.calls).toEqual(["upsert progress"]);
  });

  it("sends the newest copy in this browser, even one another tab saved", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    sync.progress("song", { best: 1, updated: "a" } as never);
    // Another tab saves the same song before this one uploads.
    write("progress:song", { best: 2, updated: "b" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.upserts).toEqual([
      [
        "progress",
        [{ user_id: USER, song_id: "song", data: { best: 2, updated: "b" } }],
      ],
    ]);
  });

  it("uploads at once a record the browser could not store", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    sync.progress("song", { best: 1 } as never, false, false);
    expect(sync.error).toMatch(/storage is full/);
    await vi.advanceTimersByTimeAsync(0);
    expect(b.calls).toEqual(["upsert progress"]);
  });

  it("withdraws a settings change that returns to the account's", async () => {
    const b = backend();
    write("owner", USER);
    b.settings = [{ data: { mode: "wait" } }];
    const sync = new CloudSync(client(b), USER);
    await sync.pull();
    sync.settings({ mode: "rhythm" } as never);
    expect(unsynced().settings).toBe(true);
    sync.settings({ mode: "wait" } as never);
    expect(unsynced().settings).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.calls).toEqual([]);
  });

  it("holds a lock every tab shares while uploading", async () => {
    const request = vi.fn((_name: string, task: () => Promise<void>) => task());
    vi.stubGlobal("navigator", { locks: { request } });
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    sync.progress("song", { best: 1 } as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(request).toHaveBeenCalledWith(
      "pawpal-account-upload",
      expect.any(Function),
    );
    expect(b.calls).toEqual(["upsert progress"]);
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
    expect(unsynced()).toEqual({
      settings: false,
      progress: [],
      deleted: [],
      practice: [],
    });
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

  it("signs out of a failed sign-in without losing an unsent practice session", async () => {
    const b = backend();
    const session = {
      id: "s1",
      day: "2026-10-18",
      startedAt: "2026-10-18T09:00:00.000Z",
      seconds: 40,
      songs: { song: 40 },
    };
    write("owner", USER);
    write("practice", [session]);
    write("unsynced", { practice: ["s1"] });
    b.failReads = true;
    const sync = new CloudSync(client(b), USER);
    await expect(sync.pull()).rejects.toBeTruthy();
    await sync.signOut();
    expect(clearAccountData).not.toHaveBeenCalled();
    expect(read("practice", [])).toEqual([session]);
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
    // Another device removes an early song between the first two pages.
    const api = client(b);
    const from = api.from;
    let reads = 0;
    api.from = ((table: "progress") => {
      if (table === "progress" && ++reads === 2)
        b.progress = b.progress.filter((row) => row.song_id !== "song-0000");
      return from(table);
    }) as never;
    await new CloudSync(api, USER).pull();
    expect(read("progress:song-2400", {})).toEqual({ best: 0 });
    expect(read("progress:song-0001", {})).toEqual({ best: 1 });
    // Every song still in the account arrives, none skipped by the removal.
    expect(read("progress:song-1000", {})).toEqual({ best: 0 });
    expect(
      [...stored.keys()].filter((key) => key.startsWith("cadence:progress:")),
    ).toHaveLength(2500);
  });

  it("reads every page of recent practice", async () => {
    const b = backend();
    write("owner", USER);
    const today = localDay(new Date());
    b.practice_sessions = [
      ...Array.from({ length: 2100 }, (_, i) => ({
        id: `s-${String(i).padStart(4, "0")}`,
        day: today,
        started_at: "x",
        seconds: 60,
        songs: {},
      })),
      {
        id: "s-old",
        day: "2000-01-01",
        started_at: "x",
        seconds: 60,
        songs: {},
      },
    ];
    await new CloudSync(client(b), USER).pull();
    const sessions = read<{ id: string }[]>("practice", []);
    expect(sessions).toHaveLength(2100);
    expect(sessions.some((s) => s.id === "s-old")).toBe(false);
  });

  it("keeps a newer copy of a session that another tab marked during an upload", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    const session = {
      id: "s1",
      day: "2026-10-18",
      startedAt: "2026-10-18T10:00:00.000Z",
      seconds: 30,
      songs: { song: 30 },
    };
    b.hang = "manual";
    sync.practice(session, true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(marker().practice).toEqual({ s1: "000030" });
    // Another tab saves a longer copy of the session while this upload runs.
    write("unsynced", { ...marker(), practice: { s1: "000045" } });
    b.release();
    await vi.advanceTimersByTimeAsync(0);
    // This upload confirmed only its own, shorter copy.
    expect(marker().practice).toEqual({ s1: "000045" });
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
