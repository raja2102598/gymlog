import { beforeEach, describe, expect, it, vi } from "vitest";
import { embedUrl, findVideos, videoSearch, videosPlayable } from "@/lib/videos";
import { memoryStorage } from "./helpers";

// A lift's videos (src/lib/videos.ts): YouTube's top few for it, searched once with the build's key and remembered.
beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));

const DAY = 24 * 60 * 60_000, NOW = Date.UTC(2026, 8, 23, 12);
/** YouTube's search, answering with `items` (or a status), and the requests it got. */
function youtube(answer: { items?: unknown[]; status?: number } | Error) {
  const asked: URL[] = [];
  const fetcher = vi.fn(async (url: string) => {
    asked.push(new URL(url));
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify({ items: answer.items ?? [] }), { status: answer.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetcher, asked };
}
const item = (id: string, title: string, channel: string) => ({ id: { videoId: id }, snippet: { title, channelTitle: channel } });

describe("findVideos", () => {
  it("searches YouTube once for a lift's top five videos that play in the app, and remembers them", async () => {
    const yt = youtube({ items: [item("aaa111", "Leg Press &amp; How To Do It Right", "Gym Channel"), { id: {}, snippet: { title: "A channel, not a video" } }, item("bbb222", "Don&#39;t Do This", "Coach &quot;K&quot;")] });
    const videos = await findVideos("Leg Press", { key: "k1", now: NOW, fetcher: yt.fetcher });
    expect(videos).toEqual([
      { id: "aaa111", title: "Leg Press & How To Do It Right", channel: "Gym Channel" },
      { id: "bbb222", title: "Don't Do This", channel: 'Coach "K"' },
    ]);
    const q = yt.asked[0];
    expect(q.origin + q.pathname).toBe("https://www.googleapis.com/youtube/v3/search");
    expect(Object.fromEntries(q.searchParams)).toMatchObject({ q: "how to do Leg Press exercise", type: "video", videoEmbeddable: "true", videoSyndicated: "true", safeSearch: "strict", maxResults: "5", key: "k1" });
    // Opened again, a week later: the same videos, and no search.
    expect(await findVideos("Leg Press", { key: "k1", now: NOW + 7 * DAY, fetcher: yt.fetcher })).toEqual(videos);
    expect(yt.fetcher).toHaveBeenCalledTimes(1);
  });

  it("without a key, finds nothing and asks nothing", async () => {
    const yt = youtube({ items: [item("aaa111", "Leg Press", "Gym Channel")] });
    expect(videosPlayable("")).toBe(false);
    expect(await findVideos("Leg Press", { key: "", now: NOW, fetcher: yt.fetcher })).toBeNull();
    expect(yt.fetcher).not.toHaveBeenCalled();
  });

  it("a search YouTube turned down, or that found nothing, is tried again a day later, not on every open", async () => {
    for (const answer of [{ status: 403 }, { items: [] }]) {
      localStorage.clear();
      const yt = youtube(answer);
      expect(await findVideos("Leg Press", { key: "k1", now: NOW, fetcher: yt.fetcher })).toBeNull();
      expect(await findVideos("Leg Press", { key: "k1", now: NOW + DAY - 1, fetcher: yt.fetcher })).toBeNull();
      expect(yt.fetcher).toHaveBeenCalledTimes(1);
      await findVideos("Leg Press", { key: "k1", now: NOW + DAY, fetcher: yt.fetcher });
      expect(yt.fetcher).toHaveBeenCalledTimes(2);
    }
  });

  it("with no connection, remembers nothing, so the next tap searches", async () => {
    const offline = youtube(new TypeError("Failed to fetch"));
    expect(await findVideos("Leg Press", { key: "k1", now: NOW, fetcher: offline.fetcher })).toBeNull();
    const online = youtube({ items: [item("aaa111", "Leg Press", "Gym Channel")] });
    expect(await findVideos("Leg Press", { key: "k1", now: NOW + 60_000, fetcher: online.fetcher })).toEqual([{ id: "aaa111", title: "Leg Press", channel: "Gym Channel" }]);
  });
});

describe("where videos play", () => {
  it("in the app, YouTube's player from youtube-nocookie.com, playing when opened; outside it, YouTube's results", () => {
    expect(embedUrl("aB_1-x")).toBe("https://www.youtube-nocookie.com/embed/aB_1-x?autoplay=1&playsinline=1&rel=0");
    expect(videoSearch("Leg Press")).toBe("https://www.youtube.com/results?search_query=how%20to%20do%20Leg%20Press%20exercise");
  });
});
