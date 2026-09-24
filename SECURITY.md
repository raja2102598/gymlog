# Security

## Reporting a problem

Please don't open a public issue for a security problem. Report it privately instead, with **Security → Report a vulnerability** on this repository, and you'll get a reply there.

## Public on purpose

These are in the site's JavaScript and in the APK, where anyone can read them. They aren't secrets:

- The Supabase project URL and its **publishable** key, which a build gets from the `NEXT_PUBLIC_*` variables (`src/lib/config.ts`). What keeps each account's data private is row-level security, in `supabase/schema.sql`: each signed-in account can read and write only its own rows.
- The Google OAuth **web client ID**. Google's client secret lives only in Supabase.
- The Android signing certificate's fingerprints, which CI prints. The signing key itself is never in the repo; CI gets it from repository secrets, and pull requests from forks don't see it.

## What would be a problem

- Any way for one account to read or change another account's rows.
- Any way to call `sync_health_days` without a valid sync key, or to do more with a key than save that account's recent Health Connect days.
- A secret (the Supabase service_role key, Google's client secret, the signing key) anywhere in the repo, the site or the APK.

If you find one of these, please report it privately as above.
