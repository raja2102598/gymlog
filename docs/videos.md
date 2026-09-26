# Videos in the app

A lift's how-to (its sheet from Train, **?** in the workout, and the library) has **Watch a video**. It plays
YouTube's top video for the lift right there, with **Another video** to go through the next four and **More on
YouTube** for the rest. The exercise library's own source, free-exercise-db, has photos but no videos, so the videos
are YouTube's.

To find them, the app needs a YouTube Data API key. Without one, **Watch videos of it** opens YouTube's results
outside the app, as before.

## How it works

- **Only when asked.** Nothing is searched for until **Watch a video** is tapped, and the player loads only then.
- **Once per lift.** A search spends 100 of the key's 10,000 free units a day, so about 100 searches a day. The app
  remembers each lift's videos on the phone (`src/lib/videos.ts`), so each lift is looked up once.
- **What it searches for.** YouTube's top five for *how to do &lt;lift&gt; exercise*: only videos that can play in
  another app, with SafeSearch strict.
- **When there's no video.** If a search finds nothing, or YouTube turns it down because the day's quota is spent,
  the lift says so and links to YouTube's results. It searches again a day later. With no connection, nothing is
  remembered, so the next tap searches.
- **The player.** YouTube's own player from `youtube-nocookie.com`, which sets no cookies until a video plays. In the
  Android app, `EmbeddedVideoPlugin.kt` keeps only that player inside the app. Links to youtube.com itself, such as
  the player's YouTube button and **More on YouTube**, open the YouTube app. It does this without giving the player
  any access to the app's plugins.

## Setting it up

1. **Google Cloud** ([console.cloud.google.com](https://console.cloud.google.com)). You can use the same project as
   [Continue with Google](google-sign-in.md).
   1. **APIs & Services → Library → YouTube Data API v3 → Enable.**
   2. **APIs & Services → Credentials → Create credentials → API key.**
   3. Open the key and restrict it:
      - **Application restrictions → Websites**:
        - `https://localhost/*`, which is the Android app: it runs the site from that address inside itself;
        - `https://<your site>/*`, for the website.
      - **API restrictions → Restrict key → YouTube Data API v3.**
      - Save.
2. **The app.** Set `NEXT_PUBLIC_YOUTUBE_API_KEY` to the key in three places:
   - as a repository variable, for the Android workflow (Settings → Secrets and variables → Actions → Variables);
   - on Vercel, for the website (Settings → Environment Variables);
   - in `.env.local`, for your own builds.

   Then build a new version. Every push to `main` does this.

The key isn't secret: it ships in the app, like the other `NEXT_PUBLIC_*` values. The restrictions above limit it to
searching YouTube from your site and the app, and its daily quota is the most anyone could spend with it.
