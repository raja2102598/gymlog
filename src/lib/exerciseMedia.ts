/* Pictures and how-to steps for the exercise library's lifts, from free-exercise-db (public domain; see
 * docs/exercise-library.md), the same source and commit as the library itself:
 *
 * - a small square picture of each lift, shipped with the app (public/exercises/thumbs), for lists;
 * - its steps, level, mechanic and force, shipped with the app (public/exercises/howto), read when its page opens;
 * - its two full-size photos, start and finish, loaded from jsDelivr pinned to that commit, so they need a
 *   connection the first time.
 *
 * scripts/build-exercise-media.mjs builds the shipped files. */
import data from "@/data/exercises.json";

export interface HowTo {
  steps: string[];
  level: string | null;
  mechanic: string | null;
  force: string | null;
  /** How many photos free-exercise-db has of it: 2, or 0 for the few it has none of. */
  photos: number;
}

const safe = (id: string) => /^[A-Za-z0-9_-]+$/.test(id);

/** The lift's small picture, for a library lift; null for one of your own (it has no id to look up). */
export const thumbUrl = (id: string | null | undefined): string | null => (id && safe(id) ? `/exercises/thumbs/${id}.webp` : null);

/** Its start and finish photos. */
export const photoUrls = (id: string): [string, string] => {
  const base = `https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@${data.commit}/exercises/${id}`;
  return [`${base}/0.jpg`, `${base}/1.jpg`];
};

const cache = new Map<string, Promise<HowTo | null>>();
/** Its steps, read once and kept: null for an id with none, or when they can't be read (offline, on the website,
 *  before they were ever read). A failed read isn't kept, so the next look tries again. */
export function loadHowTo(id: string): Promise<HowTo | null> {
  if (!safe(id)) return Promise.resolve(null);
  let p = cache.get(id);
  if (!p) {
    p = fetch(`/exercises/howto/${id}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<HowTo>) : null))
      .catch(() => null)
      .then((h) => {
        if (!h) cache.delete(id);
        return h;
      });
    cache.set(id, p);
  }
  return p;
}
