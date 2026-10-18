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
      select: () =>
        Object.assign(Promise.resolve(reply(b[table])), {
          maybeSingle: async () => reply(b[table][0] ?? null),
        }),
      upsert: (rows: unknown) => write(`upsert ${table}`, [table, rows]),
      delete: () => ({
        in: (_column: string, ids: string[]) =>
          write(`delete ${table} ${ids.join(",")}`),
      }),
    }),
    auth: {
      signOut: vi.fn(async () => ({ error: b.signOutError })),
    },
  };
  return fake as unknown as SupabaseClient & typeof fake;
}

const stored = new Map<string, string>();
let storageBlocked = false;
beforeEach(() => {
  stored.clear();
  storageBlocked = false;
  vi.stubGlobal("localStorage", {
    get length() {
      return stored.size;
    },
    key: (i: number) => [...stored.keys()][i] ?? null,
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (storageBlocked) throw new DOMException("Blocked", "SecurityError");
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
      select: () =>
        Object.assign(new Promise(() => {}), {
          maybeSingle: () => new Promise(() => {}),
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
    const api = client(b);
    const sync = new CloudSync(api, USER);
    const closeStudio = vi.fn();
    b.signOutError = { message: "offline" };
    sync.progress("song", { best: 1 } as never);
    await expect(sync.signOut(closeStudio)).rejects.toBeTruthy();
    expect(closeStudio).not.toHaveBeenCalled();
    expect(clearAccountData).not.toHaveBeenCalled();
    // Still signed in, so still syncing.
    sync.progress("song", { best: 2 } as never);
    expect(sync.pending).toBe(true);

    b.signOutError = null;
    await sync.signOut(closeStudio);
    expect(closeStudio).toHaveBeenCalledOnce();
    expect(clearAccountData).toHaveBeenCalledOnce();
    expect(
      vi.mocked(clearAccountData).mock.invocationCallOrder[0],
    ).toBeGreaterThan(closeStudio.mock.invocationCallOrder[0]);
    const sent = b.calls.length;
    sync.progress("song", { best: 3 } as never);
    await vi.advanceTimersByTimeAsync(20000);
    expect(b.calls).toHaveLength(sent);
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
