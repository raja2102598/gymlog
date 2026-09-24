# Continue with Google

The sign-in screen offers **Continue with Google** once Google is switched on in Supabase; until then the button stays hidden. On the website it goes to Google's page and back. In the Android app it opens Android's own account sheet (Credential Manager, `GoogleSignInPlugin.kt`), since Google doesn't allow signing in inside an app's web view, and hands Google's token to Supabase. A Google account with the same email as an account made with an email link is the same account, with the same data.

## Setting it up

1. **Google Cloud** ([console.cloud.google.com](https://console.cloud.google.com)), signed in with your Google account:
   1. Create a project, e.g. *Gym Log*.
   2. **Google Auth Platform → Get started**: app name *Gym Log*, your email as the support and contact email, audience **External**.
   3. **Branding**: home page: the site's address; privacy policy: the site's `/privacypolicy.html`; authorized domains: the site's domain and the Supabase project's, `<project-ref>.supabase.co`.
   4. **Audience → Publish app**, so anyone can sign in, not only listed test users. With just the basic scopes (email, profile) Google doesn't need to verify the app.
   5. **Clients → Create client → Web application**, *Gym Log web*: authorized JavaScript origin: the site's address; authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`. Keep its **client ID** and **client secret**.
   6. **Clients → Create client → Android**, *Gym Log Android*: package name `io.github.raja2102598.gymlog`, and the **SHA-1** of the app's signing certificate, which each *Android app* build prints (GitHub → Actions → *Android app* → a run → Summary, *Signing certificate*). If Google Play signs the app with a key of its own, add that key's SHA-1 too, as a second Android client (Play Console → App integrity → App signing).
2. **Supabase** → Authentication → Sign In / Providers → **Google**: turn it on, paste the web **client ID** into *Client IDs* and the **client secret** into *Client Secret*, and save. Leave *Skip nonce checks* off.
3. **The app:** set `NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID` to the web client ID (it isn't secret: it's in every Google sign-in link; the secret stays in Supabase), as a repository variable for the workflow and in `.env.local` for your own builds, and build a new version. The website needs nothing more.

Google's page on the website names the Supabase project's domain as where you're signing in; the app's account sheet names Gym Log.
