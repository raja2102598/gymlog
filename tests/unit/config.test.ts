import { afterEach, describe, expect, it, vi } from "vitest";

// Where a build points (src/lib/config.ts): the NEXT_PUBLIC_* variables, and nowhere without them.
const KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID"] as const;
type Env = Partial<Record<(typeof KEYS)[number], string>>;
const saved: Env = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

const setEnv = (env: Env) => {
  for (const k of KEYS) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
};
/** config.ts reads the variables when it's first imported, so each case sets them and imports it afresh. */
async function load(env: Env) {
  setEnv(env);
  vi.resetModules();
  return { ...(await import("@/lib/config")), ...(await import("@/lib/native")) };
}
afterEach(() => setEnv(saved));

describe("where a build points", () => {
  it("is nowhere without the variables, so the app shows its setup screen", async () => {
    const c = await load({});
    expect([c.SUPABASE_URL, c.SUPABASE_ANON_KEY, c.SITE_URL, c.APP_LOGIN_PAGE, c.GOOGLE_WEB_CLIENT_ID]).toEqual(["", "", "", "", ""]);
  });

  it("is your project with the variables set, without trailing slashes or spaces", async () => {
    const c = await load({
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijkl.supabase.co/",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: " sb_publishable_test ",
      NEXT_PUBLIC_SITE_URL: "https://my-gym-log.example/",
      NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID: "1-abc.apps.googleusercontent.com",
    });
    expect(c.SUPABASE_URL).toBe("https://abcdefghijkl.supabase.co");
    expect(c.SUPABASE_ANON_KEY).toBe("sb_publishable_test");
    expect(c.SITE_URL).toBe("https://my-gym-log.example");
    expect(c.APP_LOGIN_PAGE).toBe("https://my-gym-log.example/app-login.html");
    expect(c.GOOGLE_WEB_CLIENT_ID).toBe("1-abc.apps.googleusercontent.com");
  });

  it("accepts the key under the name Vercel's Supabase integration uses, with the newer name winning", async () => {
    const older = await load({ NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijkl.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_older" });
    expect(older.SUPABASE_ANON_KEY).toBe("sb_publishable_older");
    const both = await load({ NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijkl.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_newer", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_older" });
    expect(both.SUPABASE_ANON_KEY).toBe("sb_publishable_newer");
  });

  it("treats blank variables as unset", async () => {
    const c = await load({ NEXT_PUBLIC_SUPABASE_URL: " ", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "", NEXT_PUBLIC_SITE_URL: "", NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID: "" });
    expect([c.SUPABASE_URL, c.SUPABASE_ANON_KEY, c.SITE_URL, c.APP_LOGIN_PAGE, c.GOOGLE_WEB_CLIENT_ID]).toEqual(["", "", "", "", ""]);
  });
});
