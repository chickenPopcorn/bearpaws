import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CloudSync } from "../src/cloud";
import { clearAccountData, read, write } from "../src/storage";

vi.mock("../src/storage", async (importActual) => ({
  ...(await importActual<typeof import("../src/storage")>()),
  clearAccountData: vi.fn(),
}));

const USER = "11111111-1111-1111-1111-111111111111";

interface Backend {
  settings: { data: unknown }[];
  progress: { song_id: string; data: unknown }[];
  upserts: [string, unknown][];
  calls: string[];
  failWrites: boolean;
}

function backend(): Backend {
  return {
    settings: [],
    progress: [],
    upserts: [],
    calls: [],
    failWrites: false,
  };
}

/** Just the parts of the Supabase client that CloudSync uses. */
function client(b: Backend) {
  const reply = (data: unknown, error: unknown = null) => ({ data, error });
  const offline = () => (b.failWrites ? { message: "offline" } : null);
  const fake = {
    from: (table: "settings" | "progress") => ({
      select: () =>
        Object.assign(Promise.resolve(reply(b[table])), {
          maybeSingle: async () => reply(b[table][0] ?? null),
        }),
      upsert: async (rows: unknown) => {
        b.calls.push(`upsert ${table}`);
        if (!b.failWrites) b.upserts.push([table, rows]);
        return reply(null, offline());
      },
      delete: () => ({
        eq: async (_column: string, value: string) => {
          b.calls.push(`delete ${table} ${value}`);
          return reply(null, offline());
        },
      }),
    }),
    auth: { signOut: vi.fn(async () => ({ error: null })) },
  };
  return fake as unknown as SupabaseClient & typeof fake;
}

const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  vi.stubGlobal("localStorage", {
    get length() {
      return stored.size;
    },
    key: (i: number) => [...stored.keys()][i] ?? null,
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  vi.useFakeTimers();
  vi.mocked(clearAccountData).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("account sync", () => {
  it("loads the account's settings and progress at sign-in", async () => {
    const b = backend();
    write("settings", { mode: "listen" });
    write("progress:newer-here", { updated: "2026-03-01", best: 7 });
    write("progress:newer-there", { updated: "2026-01-01", best: 1 });
    b.settings = [{ data: { mode: "rhythm" } }];
    b.progress = [
      { song_id: "newer-here", data: { updated: "2026-02-01", best: 2 } },
      { song_id: "newer-there", data: { updated: "2026-02-01", best: 9 } },
      { song_id: "only-there", data: { updated: "2026-02-01", best: 5 } },
    ];
    const sync = new CloudSync(client(b), USER);
    await sync.pull();

    expect(read("owner", "")).toBe(USER);
    expect(read("settings", {})).toEqual({ mode: "rhythm" });
    expect(read("progress:newer-there", {})).toMatchObject({ best: 9 });
    expect(read("progress:only-there", {})).toMatchObject({ best: 5 });
    expect(read("progress:newer-here", {})).toMatchObject({ best: 7 });
    expect(sync.error).toBe("");

    // Only the copy that is newer on this browser goes up.
    await vi.advanceTimersByTimeAsync(0);
    expect(b.upserts).toEqual([
      [
        "progress",
        [
          expect.objectContaining({
            user_id: USER,
            song_id: "newer-here",
            data: { updated: "2026-03-01", best: 7 },
          }),
        ],
      ],
    ]);
  });

  it("uploads this browser's settings on the first sign-in", async () => {
    const b = backend();
    write("settings", { mode: "listen" });
    const sync = new CloudSync(client(b), USER);
    await sync.pull();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.upserts).toEqual([
      ["settings", expect.objectContaining({ data: { mode: "listen" } })],
    ]);
  });

  it("clears another account's settings and progress before loading this one", async () => {
    write("owner", "someone-else");
    await new CloudSync(client(backend()), USER).pull();
    expect(clearAccountData).toHaveBeenCalledOnce();
    expect(read("owner", "")).toBe(USER);
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

  it("uploads a burst of changes once, and retries a failed upload", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    const onChange = vi.fn();
    sync.onChange = onChange;
    sync.settings({ mode: "wait" } as never);
    sync.progress("song", { best: 1 } as never);
    sync.progress("song", { best: 2 } as never);
    await vi.advanceTimersByTimeAsync(1999);
    expect(b.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.calls).toEqual(["upsert settings", "upsert progress"]);
    expect(b.upserts[1][1]).toEqual([
      expect.objectContaining({ song_id: "song", data: { best: 2 } }),
    ]);

    b.failWrites = true;
    sync.progress("song", { best: 3 } as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.error).toMatch(/Retrying/);
    expect(sync.pending).toBe(true);
    expect(onChange).toHaveBeenCalled();
    b.failWrites = false;
    await vi.advanceTimersByTimeAsync(15000);
    expect(sync.error).toBe("");
    expect(sync.pending).toBe(false);
    expect(b.upserts.at(-1)?.[1]).toEqual([
      expect.objectContaining({ data: { best: 3 } }),
    ]);
  });

  it("forgets a removed song's progress, including a waiting upload", async () => {
    const b = backend();
    const sync = new CloudSync(client(b), USER);
    sync.progress("gone", { best: 1 } as never);
    sync.forgetProgress("gone");
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.calls).toEqual(["delete progress gone"]);
    expect(sync.pending).toBe(false);
  });

  it("signs out after uploading, and keeps changes it could not upload", async () => {
    const b = backend();
    const api = client(b);
    const sync = new CloudSync(api, USER);
    sync.progress("song", { best: 1 } as never);
    await sync.signOut();
    expect(b.calls).toEqual(["upsert progress"]);
    expect(clearAccountData).toHaveBeenCalledOnce();
    expect(api.auth.signOut).toHaveBeenCalledOnce();

    // Nothing is queued once signed out.
    sync.progress("song", { best: 2 } as never);
    await vi.advanceTimersByTimeAsync(20000);
    expect(b.calls).toEqual(["upsert progress"]);

    const offline = backend();
    offline.failWrites = true;
    const other = new CloudSync(client(offline), USER);
    vi.mocked(clearAccountData).mockClear();
    other.progress("song", { best: 1 } as never);
    await other.signOut();
    expect(clearAccountData).not.toHaveBeenCalled();
  });
});
