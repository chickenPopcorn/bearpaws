import { readFileSync } from "node:fs";
import {
  test as base,
  type BrowserContext,
  type Route,
} from "@playwright/test";

/**
 * The Supabase project the e2e build talks to. Nothing answers at this
 * address: every request to it is answered by FakeSupabase below, inside the
 * browser context, so the suite needs no network, account or Google sign-in.
 */
export const SUPABASE_URL = "https://e2e.supabase.test";
/** Where supabase-js keeps the session: sb-<first host label>-auth-token. */
const SESSION_KEY = "sb-e2e-auth-token";

export const USER = {
  id: "00000000-0000-4000-8000-00000000e2e0",
  email: "george@example.com",
  firstName: "George",
};

interface LibrarySong {
  id: string;
  title: string;
  [key: string]: unknown;
}
/** The three library songs the unit tests use (see tests/fixtures). */
const fixtureSongs = (
  JSON.parse(
    readFileSync(
      new URL("../tests/fixtures/library-songs.json", import.meta.url),
      "utf8",
    ),
  ) as { song: LibrarySong }[]
).map(({ song }) => song);
const fixture = (id: string) => fixtureSongs.find((song) => song.id === id)!;

/**
 * The library bucket: one song in each book of George Bear’s Classes, and one
 * from another collection that the app must leave out.
 */
export const LIBRARY = [
  { song: fixture("cadence-dancing-raindrops-v1"), book: "recital-3" },
  { song: fixture("pawpal-five-oclock-v1"), book: "lesson-3" },
  { song: fixture("cadence-ode-to-joy-v1"), collection: "songs" },
].map(({ song, book, collection = "classes" }) => ({
  song,
  entry: {
    id: song.id,
    title: song.title,
    collection,
    ...(book && { book }),
    song: `songs/${song.id}.json`,
    midi: `songs/${song.id}.mid`,
  },
}));

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, HEAD, POST, PATCH, DELETE, OPTIONS",
  "access-control-expose-headers": "content-range",
};

/** An access token shaped like Supabase's. Nothing checks its signature. */
function accessToken(exp: number) {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    part({ alg: "HS256", typ: "JWT" }),
    part({
      sub: USER.id,
      email: USER.email,
      aud: "authenticated",
      role: "authenticated",
      exp,
      iat: exp - 3600,
      session_id: "e2e-session",
    }),
    "e2e-signature",
  ].join(".");
}

/** A signed-in Google session for USER, valid for an hour. */
export function session() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: accessToken(expiresAt),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: "e2e-refresh-token",
    user: {
      id: USER.id,
      aud: "authenticated",
      role: "authenticated",
      email: USER.email,
      app_metadata: { provider: "google", providers: ["google"] },
      user_metadata: {
        given_name: USER.firstName,
        full_name: `${USER.firstName} Bear`,
      },
      identities: [],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  };
}

/**
 * The browser storage of a context already signed in, as supabase-js leaves
 * it after Google sign-in.
 */
export const signedIn = (origin: string) => ({
  cookies: [],
  origins: [
    {
      origin,
      localStorage: [{ name: SESSION_KEY, value: JSON.stringify(session()) }],
    },
  ],
});

type Row = { user_id: string; song_id: string; data: unknown };

/**
 * Supabase as the app uses it: Google sign-in (PKCE), the settings and
 * progress tables, and the public song library bucket. Tests read and change
 * its state to arrange and check what the app sent.
 */
export class FakeSupabase {
  /** The account's settings row, or null for a new account. */
  settings: Record<string, unknown> | null = null;
  /** The account's progress rows by song id. */
  progress = new Map<string, unknown>();
  /** Every settings upload, oldest first. */
  settingsUploads: Record<string, unknown>[] = [];
  /** Every Google sign-in the app started. */
  authorizations: URL[] = [];
  /** How many times the app signed out with Supabase. */
  signOuts = 0;
  /** Answer library requests with a server error. */
  libraryDown = false;
  /** Requests nothing here answers, which a test should fail on. */
  unexpected: string[] = [];

  async attach(context: BrowserContext) {
    await context.route(`${SUPABASE_URL}/**`, (route) => this.handle(route));
  }

  private async handle(route: Route) {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname;
    if (method === "OPTIONS")
      return route.fulfill({ status: 204, headers: CORS });

    const library = "/storage/v1/object/public/library/";
    if (path.startsWith(library))
      return this.library(route, path.slice(library.length));

    if (path === "/auth/v1/authorize") {
      // Google says yes at once and returns to the app with a PKCE code.
      this.authorizations.push(url);
      const back = new URL(url.searchParams.get("redirect_to")!);
      back.searchParams.set("code", "e2e-auth-code");
      return route.fulfill({ status: 302, headers: { location: back.href } });
    }
    if (path === "/auth/v1/token") return json(route, session());
    if (path === "/auth/v1/user") return json(route, session().user);
    if (path === "/auth/v1/logout") {
      this.signOuts++;
      return route.fulfill({ status: 204, headers: CORS });
    }

    if (path === "/rest/v1/settings") {
      if (method === "GET")
        return json(route, this.settings ? [{ data: this.settings }] : []);
      if (method === "POST") {
        const { data } = request.postDataJSON() as {
          data: Record<string, unknown>;
        };
        this.settings = data;
        this.settingsUploads.push(data);
        return route.fulfill({ status: 201, headers: CORS, body: "" });
      }
    }
    if (path === "/rest/v1/progress") {
      if (method === "POST") {
        const rows = [request.postDataJSON() as Row | Row[]].flat();
        for (const row of rows) this.progress.set(row.song_id, row.data);
        return route.fulfill({ status: 201, headers: CORS, body: "" });
      }
      const rows = this.progressRows(url.searchParams.get("song_id"));
      if (method === "HEAD")
        return route.fulfill({
          status: 200,
          headers: { ...CORS, "content-range": `*/${rows.length}` },
        });
      if (method === "GET") return json(route, rows);
    }

    this.unexpected.push(`${method} ${path}`);
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  }

  /** Progress rows in song id order, with the app's one song_id filter. */
  private progressRows(filter: string | null) {
    let rows = [...this.progress]
      .map(([song_id, data]) => ({ song_id, data }))
      .sort((a, b) => a.song_id.localeCompare(b.song_id));
    if (filter?.startsWith("gt."))
      rows = rows.filter((row) => row.song_id > filter.slice(3));
    else if (filter?.startsWith("in.(")) {
      const ids = filter
        .slice(4, -1)
        .split(",")
        .map((id) => id.replace(/^"|"$/g, ""));
      rows = rows.filter((row) => ids.includes(row.song_id));
    }
    return rows;
  }

  private library(route: Route, file: string) {
    if (this.libraryDown)
      return route.fulfill({ status: 503, headers: CORS, body: "down" });
    if (file === "index.json")
      return json(route, {
        version: 1,
        songs: LIBRARY.map(({ entry }) => entry),
      });
    const found = LIBRARY.find(
      ({ entry }) => entry.song === file || entry.midi === file,
    );
    if (!found) return route.fulfill({ status: 404, headers: CORS });
    if (file.endsWith(".json")) return json(route, found.song);
    return route.fulfill({
      status: 200,
      headers: { ...CORS, "content-type": "audio/midi" },
      body: Buffer.from("MThd"),
    });
  }
}

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    headers: { ...CORS, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Tests run signed in to a new account by default; `test.use({ storageState:
 * { cookies: [], origins: [] } })` starts signed out instead. Each test fails
 * if the app made a Supabase request the fake does not know.
 */
export const test = base.extend<{ supabase: FakeSupabase }>({
  storageState: async ({ baseURL }, use) => use(signedIn(baseURL!)),
  supabase: [
    async ({ context }, use) => {
      const supabase = new FakeSupabase();
      await supabase.attach(context);
      await use(supabase);
      if (supabase.unexpected.length)
        throw new Error(
          `Unexpected Supabase requests: ${supabase.unexpected.join(", ")}`,
        );
    },
    { auto: true },
  ],
});
export { expect } from "@playwright/test";
