import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioClaim } from "../src/studioClaim";

/** Web Locks for one lock name, as tabs of one site share them. */
function locks() {
  let holder: { abort: (error: unknown) => void } | null = null;
  return {
    request(
      _name: string,
      options: { ifAvailable?: boolean; steal?: boolean },
      callback: (lock: object | null) => unknown,
    ) {
      if (holder && options.ifAvailable) return Promise.resolve(callback(null));
      if (holder && options.steal) {
        holder.abort(new DOMException("Taken", "AbortError"));
        holder = null;
      }
      return new Promise((resolve, reject) => {
        const mine = { abort: reject };
        holder = mine;
        void Promise.resolve(callback({})).then(() => {
          if (holder === mine) holder = null;
          resolve(undefined);
        });
      });
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("navigator", { locks: locks() });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("one studio tab at a time", () => {
  it("lets a second tab in only by taking the studio over", async () => {
    const firstTaken = vi.fn();
    const first = new StudioClaim(firstTaken);
    const second = new StudioClaim(vi.fn());
    expect(await first.claim()).toBe(true);
    expect(await second.claim()).toBe(false);
    expect(await second.claim(true)).toBe(true);
    await Promise.resolve();
    expect(firstTaken).toHaveBeenCalledOnce();
    expect(first.held).toBe(false);
    expect(second.held).toBe(true);
  });

  it("frees the studio for another tab after signing out", async () => {
    const first = new StudioClaim(vi.fn());
    const second = new StudioClaim(vi.fn());
    expect(await first.claim()).toBe(true);
    first.give();
    await Promise.resolve();
    expect(await second.claim()).toBe(true);
  });

  it("lets this tab in when the lock request itself fails", async () => {
    vi.stubGlobal("navigator", {
      locks: {
        request: () => Promise.reject(new DOMException("No", "SecurityError")),
      },
    });
    expect(await new StudioClaim(vi.fn()).claim()).toBe(true);
  });

  it("lets every tab in where Web Locks are missing", async () => {
    vi.stubGlobal("navigator", {});
    expect(await new StudioClaim(vi.fn()).claim()).toBe(true);
    expect(await new StudioClaim(vi.fn()).claim()).toBe(true);
  });
});
