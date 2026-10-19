import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import { firstName } from "../src/supabase";

const user = (profile: Record<string, unknown>) =>
  ({ user_metadata: profile }) as unknown as User;

describe("the account's first name", () => {
  it("takes the Google given name, else the first word of the full name", () => {
    expect(
      firstName(user({ given_name: "George", full_name: "George Bear" })),
    ).toBe("George");
    expect(firstName(user({ full_name: "  Mozart Mouse " }))).toBe("Mozart");
    expect(firstName(user({ name: "Clara" }))).toBe("Clara");
  });

  it("is blank without a name", () => {
    expect(firstName(user({ given_name: "  ", picture: "x" }))).toBe("");
    expect(firstName(undefined)).toBe("");
  });
});
