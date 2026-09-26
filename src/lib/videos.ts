/* A lift's videos, played in the app (components/exercise/LiftVideo.tsx): YouTube's top few for it, found with the
 * YouTube Data API and remembered on this phone, since each search spends a hundredth of the key's free daily quota.
 * Without a key (config.ts), or while a search can't be made, the lift keeps its link to YouTube's results. */
import { YOUTUBE_API_KEY } from "./config";
import { lsGet, lsSet } from "./storage";

export interface Video {
  id: string;
  title: string;
  channel: string;
}

/** What a lift's videos are searched for: the same words as its link to YouTube's results. */
export const videoQuery = (name: string) => `how to do ${name} exercise`;

/** YouTube's results for a lift, opened outside the app. */
export const videoSearch = (name: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(videoQuery(name))}`;

/** The player for one video, from youtube-nocookie.com (no cookies until it plays), playing in place when opened.
 *  The Android app lets only these addresses load inside it (EmbeddedVideoPlugin.kt). */
export const embedUrl = (id: string) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&playsinline=1&rel=0`;

/** Whether this build can play videos in the app: it has a key to search with. */
export const videosPlayable = (key = YOUTUBE_API_KEY) => !!key;

const KEY = "gymlog.videos.v1";
/** A search that found nothing, or that YouTube turned down (the day's quota spent), is tried again a day later. */
const RETRY_MS = 24 * 60 * 60_000;
type Found = { at: number; videos: Video[] };

// YouTube gives titles with HTML entities in them ("Squat &amp; Lunge", "Don&#39;t").
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: unknown) =>
  String(s ?? "").replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (m, dec?: string, hex?: string, word?: string) =>
    dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : (ENTITIES[word!.toLowerCase()] ?? m),
  );

/**
 * A lift's videos: the ones found before, or YouTube's top five that can play in another app, found now. Null when
 * there's none to play: no key, no connection, or a search that found nothing or was turned down within the last day.
 */
export async function findVideos(name: string, { key = YOUTUBE_API_KEY, now = Date.now(), fetcher = fetch }: { key?: string; now?: number; fetcher?: typeof fetch } = {}): Promise<Video[] | null> {
  if (!key) return null;
  const q = videoQuery(name), seen = lsGet<Record<string, Found>>(KEY, {})[q];
  if (seen?.videos.length) return seen.videos;
  if (seen && now - seen.at < RETRY_MS) return null;
  const url = `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    videoSyndicated: "true",
    safeSearch: "strict",
    maxResults: "5",
    q,
    fields: "items(id/videoId,snippet(title,channelTitle))",
    key,
  })}`;
  let videos: Video[] = [];
  try {
    const res = await fetcher(url);
    if (res.ok) {
      const items = ((await res.json()) as { items?: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }[] }).items ?? [];
      videos = items.filter((it) => it.id?.videoId).map((it) => ({ id: it.id!.videoId!, title: decode(it.snippet?.title), channel: decode(it.snippet?.channelTitle) }));
    }
  } catch {
    return null; // no connection, or YouTube out of reach: nothing remembered, so the next tap searches
  }
  lsSet(KEY, { ...lsGet<Record<string, Found>>(KEY, {}), [q]: { at: now, videos } });
  return videos.length ? videos : null;
}
