// Where this build of Gym Log points: the Supabase project, the site's address and the Google sign-in client.
//
// All four come from NEXT_PUBLIC_* variables, which Next.js inlines when it builds (see .env.example): from
// .env.local for `npm run dev` and `npm run build`, from the Vercel project's environment variables, and from
// repository variables for the Android workflow. Nothing about a deployment is written in the source, and a
// build made without them shows the setup screen instead of signing in.
//
// None of them is secret. They ship in the site's JavaScript and in the APK, where anyone can read them. What
// keeps each account's data private is row-level security (supabase/schema.sql): a signed-in account can read
// and write only its own rows. The secrets (the Supabase service_role key, Google's client secret, the Android
// signing key) live in Supabase, Google Cloud and the repository's Actions secrets, never here.

/** The Supabase project's URL. */
export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");

/** The project's publishable (client) key. Never the service_role / secret key. */
export const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "").trim();

/** The site's address, without a trailing slash. Sign-in links asked for in the Android app land on its app-login.html. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");

/** Continue with Google in the Android app: the OAuth *Web* client ID from Google Cloud (public, like the address of
 *  a sign-in page; its secret lives only in Supabase). Empty keeps the app's Google button hidden. README.md,
 *  Continue with Google, has the steps. */
export const GOOGLE_WEB_CLIENT_ID = (process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID || "").trim();
