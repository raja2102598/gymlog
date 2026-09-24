import { afterEach, describe, expect, it, vi } from "vitest";

// Where a build points (src/lib/config.ts): the live app's settings unless the NEXT_PUBLIC_* variables are set.
const KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID"] as const;
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
  it("is the live app without the variables, with its Google client", async () => {
    const c = await load({});
    expect(c.SUPABASE_URL).toMatch(/^https:\/\/[a-z]+\.supabase\.co$/);
    expect(c.SUPABASE_ANON_KEY).toMatch(/^sb_publishable_/);
    expect(c.SITE_URL).toMatch(/^https:\/\/[^/]+$/);
    expect(c.APP_LOGIN_PAGE).toBe(`${c.SITE_URL}/app-login.html`);
    expect(c.GOOGLE_WEB_CLIENT_ID).toMatch(/\.apps\.googleusercontent\.com$/);
  });

  it("is your own project with the variables set", async () => {
    const c = await load({
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijkl.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      NEXT_PUBLIC_SITE_URL: "https://my-gym-log.example/",
      NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID: "1-abc.apps.googleusercontent.com",
    });
    expect(c.SUPABASE_URL).toBe("https://abcdefghijkl.supabase.co");
    expect(c.SUPABASE_ANON_KEY).toBe("sb_publishable_test");
    expect(c.SITE_URL).toBe("https://my-gym-log.example");
    expect(c.APP_LOGIN_PAGE).toBe("https://my-gym-log.example/app-login.html");
    expect(c.GOOGLE_WEB_CLIENT_ID).toBe("1-abc.apps.googleusercontent.com");
  });

  it("keeps the live app's Google client for the live app's project only", async () => {
    const own = await load({ NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijkl.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
    expect(own.GOOGLE_WEB_CLIENT_ID).toBe("");
  });

  it("treats empty variables as unset", async () => {
    const live = await load({});
    const empty = await load({ NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "", NEXT_PUBLIC_SITE_URL: "", NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID: "" });
    expect(empty.SUPABASE_URL).toBe(live.SUPABASE_URL);
    expect(empty.SUPABASE_ANON_KEY).toBe(live.SUPABASE_ANON_KEY);
    expect(empty.SITE_URL).toBe(live.SITE_URL);
    expect(empty.GOOGLE_WEB_CLIENT_ID).toBe(live.GOOGLE_WEB_CLIENT_ID);
  });
});
