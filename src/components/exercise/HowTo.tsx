"use client";
import { CirclePlay } from "lucide-react";
import { useEffect, useState } from "react";
import { loadHowTo, photoUrls, type HowTo as HowToData } from "@/lib/exerciseMedia";

/** Videos of a lift: YouTube's results for it, opened outside the app. No open dataset has videos to ship with it. */
export const videoSearch = (name: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`how to do ${name} exercise`)}`;

const MECHANIC: Record<string, string> = { compound: "Works several joints", isolation: "Works one joint" };
const FORCE: Record<string, string> = { push: "Push", pull: "Pull", static: "Hold" };
const LEVEL: Record<string, string> = { beginner: "Beginner", intermediate: "Intermediate", expert: "Advanced" };

/** How to do a library lift: its start and finish photos, its steps, and what kind of lift it is, from
 *  free-exercise-db. The steps ship with the app; the photos load from the web and are left out when they can't. */
export function HowTo({ id, name, headingId }: { id: string; name: string; headingId?: string }) {
  const [state, setState] = useState<{ id: string; h: HowToData | null } | null>(null);
  const [noPhotos, setNoPhotos] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadHowTo(id).then((h) => {
      if (live) setState({ id, h });
    });
    return () => {
      live = false;
    };
  }, [id]);
  const h = state?.id === id ? state.h : undefined;
  if (h === undefined) return <p className="sub howto-wait">Loading the steps…</p>;
  if (!h) return <p className="sub">The steps for this lift aren’t available offline yet. They show once you’re connected.</p>;
  const [start, end] = photoUrls(id);
  const tags = [h.level && LEVEL[h.level], h.mechanic && MECHANIC[h.mechanic], h.force && FORCE[h.force]].filter(Boolean);
  return (
    <div className="howto-body" aria-labelledby={headingId}>
      {h.photos >= 2 && noPhotos !== id ? (
        // The two photos take turns, start then finish, so the lift is seen moving; with Reduce motion on, they sit
        // side by side instead (ds.css).
        <div className="howto-photos">
          {[start, end].map((src, i) => (
            <figure key={src}>
              {/* eslint-disable-next-line @next/next/no-img-element -- remote photos, shown as they are */}
              <img src={src} alt={`${name}, ${i ? "finish" : "start"} position`} loading="lazy" decoding="async" width={400} height={267} onError={() => setNoPhotos(id)} />
              <figcaption>{i ? "Finish" : "Start"}</figcaption>
            </figure>
          ))}
          <span className="howto-loop" aria-hidden="true">
            Start ⇄ finish
          </span>
        </div>
      ) : h.photos >= 2 ? (
        <p className="sub">The photos need a connection.</p>
      ) : null}
      <a className="btn btn-sm howto-video" href={videoSearch(name)} target="_blank" rel="noreferrer">
        <CirclePlay size={18} aria-hidden="true" />
        Watch videos of it
      </a>
      {tags.length ? (
        <p className="howto-tags">
          {tags.map((t) => (
            <span key={t} className="pill">
              {t}
            </span>
          ))}
        </p>
      ) : null}
      <ol className="howto-steps">
        {h.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <p className="howto-credit">
        Steps and photos from{" "}
        <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noreferrer">
          free-exercise-db
        </a>
        , public domain.
      </p>
    </div>
  );
}
