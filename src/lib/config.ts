// Where this build of Gym Log points: the Supabase project, the site's address and the Google sign-in client.
//
// Nothing here is secret. These values ship in the site's JavaScript and in the APK, where anyone can read them.
// What keeps each account's data private is row-level security (supabase/schema.sql): a signed-in account can
// read and write only its own rows. The secrets (the Supabase service_role key, Google's client secret, the
// Android signing key) live in Supabase, Google Cloud and the repository's Actions secrets, never here.
//
// Without the NEXT_PUBLIC_* variables (see .env.example) a build points at the live app. Set them to point a
// build at your own project: in .env.local for `npm run dev` and `npm run build`, in the Vercel project's
// settings, and as repository variables for the Android workflow. Next.js inlines them at build time.

const LIVE_SUPABASE_URL = "https://dtudesmwddtlcekhqees.supabase.co";

/** The Supabase project's URL. */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || LIVE_SUPABASE_URL;

/** The project's publishable (client) key. Never the service_role / secret key. */
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_UMyrR4w1Pmas6KllEUy1LQ_Xteqdigk";

/** The site's address, without a trailing slash. Sign-in links asked for in the Android app land on its app-login.html. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://gym-log-omega-seven.vercel.app").replace(/\/+$/, "");

/** Continue with Google in the Android app: the OAuth *Web* client ID from Google Cloud (public, like the address of
 *  a sign-in page; its secret lives only in Supabase). A Google client goes with one Supabase project, so the live
 *  app's is only used with the live app's project. Empty keeps the app's Google button hidden. README.md, Continue
 *  with Google, has the steps. */
export const GOOGLE_WEB_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
  (SUPABASE_URL === LIVE_SUPABASE_URL ? "845137186862-fs9dnmeqb10h5bb3k99k6jjrsi1iskbl.apps.googleusercontent.com" : "");
