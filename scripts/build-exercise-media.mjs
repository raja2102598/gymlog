// Builds the pictures and how-to steps for the exercise library, from the same free-exercise-db commit as
// src/data/exercises.json (https://github.com/yuhonas/free-exercise-db, public domain under the Unlicense; see
// docs/exercise-library.md):
//
//   public/exercises/thumbs/<id>.webp   a small square picture of each lift, for lists (its first photo, cropped)
//   public/exercises/howto/<id>.json    its steps, level, mechanic and force, for its how-to section
//
// The full-size photos aren't copied: the how-to section loads them from jsDelivr, pinned to that commit
// (photoUrls in src/lib/exerciseMedia.ts). It uses sharp, which comes with Next.js. Run by hand after updating the
// library:
//
//   node scripts/build-exercise-media.mjs
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const lib = JSON.parse(fs.readFileSync("src/data/exercises.json", "utf8"));
const RAW = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${lib.commit}`;
const THUMB = 112; // nearly 3x the 40px it's shown at, for sharp photos on dense screens
const OUT = "public/exercises";

const upstream = new Map((await (await fetch(`${RAW}/dist/exercises.json`)).json()).map((x) => [x.id, x]));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(`${OUT}/thumbs`, { recursive: true });
fs.mkdirSync(`${OUT}/howto`, { recursive: true });

const clean = (s) => s.replace(/\s+/g, " ").trim();
let thumbs = 0, bytes = 0;
const ids = lib.exercises.map((x) => x.id);
// A few at a time: kind to the CDN, and quick enough.
for (let i = 0; i < ids.length; i += 8) {
  await Promise.all(
    ids.slice(i, i + 8).map(async (id) => {
      const x = upstream.get(id);
      if (!x) throw new Error(`${id} isn't in free-exercise-db at ${lib.commit}`);
      const howto = { steps: x.instructions.map(clean).filter(Boolean), level: x.level ?? null, mechanic: x.mechanic ?? null, force: x.force ?? null, photos: x.images.length };
      fs.writeFileSync(`${OUT}/howto/${id}.json`, JSON.stringify(howto));
      if (!x.images.length) return;
      const res = await fetch(`${RAW}/exercises/${x.images[0]}`);
      if (!res.ok) throw new Error(`${x.images[0]}: ${res.status}`);
      const out = await sharp(Buffer.from(await res.arrayBuffer()))
        .resize(THUMB, THUMB, { fit: "cover", position: sharp.strategy.attention })
        .webp({ quality: 62, effort: 6 })
        .toBuffer();
      fs.writeFileSync(path.join(OUT, "thumbs", `${id}.webp`), out);
      thumbs++;
      bytes += out.length;
    }),
  );
}
console.log(`${ids.length} how-to files, ${thumbs} thumbnails (${Math.round(bytes / 1024)} KB)`);
