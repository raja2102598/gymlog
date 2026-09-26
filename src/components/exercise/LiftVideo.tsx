"use client";
import { CirclePlay, ExternalLink } from "lucide-react";
import { useState } from "react";
import { embedUrl, findVideos, videoSearch, videosPlayable, type Video } from "@/lib/videos";

type State = { kind: "idle" } | { kind: "finding" } | { kind: "playing"; videos: Video[]; at: number } | { kind: "none"; why: string };

/**
 * Videos of a lift, in its how-to: Watch a video finds YouTube's top few for it (once; lib/videos.ts remembers them)
 * and plays the first right here, with Another video to go through the rest and More on YouTube for everything
 * else. Only when asked, since each search spends some of the day's quota and a player is heavy to load. A build
 * without a key, or a lift with nothing found, keeps the link to YouTube's results instead.
 */
export function LiftVideo({ name }: { name: string }) {
  const [s, setS] = useState<State>({ kind: "idle" });
  const more = (label: string) => (
    <a className="btn btn-sm howto-video" href={videoSearch(name)} target="_blank" rel="noreferrer">
      <ExternalLink size={16} aria-hidden="true" />
      {label}
    </a>
  );
  if (!videosPlayable()) {
    return (
      <a className="btn btn-sm howto-video" href={videoSearch(name)} target="_blank" rel="noreferrer">
        <CirclePlay size={18} aria-hidden="true" />
        Watch videos of it
      </a>
    );
  }
  if (s.kind === "playing") {
    const v = s.videos[s.at];
    return (
      <div className="howto-vid">
        <div className="howto-player">
          <iframe
            key={v.id}
            src={embedUrl(v.id)}
            title={`${v.title}, from YouTube`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            // YouTube's player won't play without knowing the page it's on (its error 153).
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
        <p className="howto-vid-t">
          {v.title}
          {v.channel ? <span> · {v.channel}</span> : null}
        </p>
        <div className="howto-vid-acts">
          {s.videos.length > 1 ? (
            <button type="button" className="btn btn-sm" data-video="next" onClick={() => setS({ ...s, at: (s.at + 1) % s.videos.length })}>
              Another video
            </button>
          ) : null}
          {more("More on YouTube")}
        </div>
      </div>
    );
  }
  if (s.kind === "none") {
    return (
      <div className="howto-vid">
        <p className="sub">{s.why}</p>
        {more("Watch videos on YouTube")}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="btn btn-sm howto-video"
      data-video="play"
      disabled={s.kind === "finding"}
      onClick={async () => {
        if (!navigator.onLine) return setS({ kind: "none", why: "Videos need a connection." });
        setS({ kind: "finding" });
        const videos = await findVideos(name);
        setS(videos ? { kind: "playing", videos, at: 0 } : { kind: "none", why: "No video to play here right now." });
      }}
    >
      <CirclePlay size={18} aria-hidden="true" />
      {s.kind === "finding" ? "Finding a video…" : "Watch a video"}
    </button>
  );
}
