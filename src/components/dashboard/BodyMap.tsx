"use client";
import { useEffect, useState } from "react";
import { SegmentedControl } from "@/components/ds/parts";
import type { BodySide } from "@/data/bodyMap";
import { bodyLevel, type BodyMode, type BodyMuscle } from "@/lib/dashboard";
import { daysBetween } from "@/lib/stats";
import { MUSCLES, type Muscle } from "@/lib/library";
import type { DayKey } from "@/lib/types";

/** Which of the app's muscles each of the outlines' groups shows: the strongest of them. The rest of the body (hands,
 *  knees, shins, feet, the head) is drawn plain. */
const REGION: Record<string, Muscle[]> = {
  chest: ["chest"],
  abs: ["abdominals"],
  obliques: ["abdominals"],
  biceps: ["biceps"],
  triceps: ["triceps"],
  deltoids: ["shoulders"],
  forearm: ["forearms"],
  quadriceps: ["quadriceps"],
  calves: ["calves"],
  adductors: ["adductors"],
  trapezius: ["traps"],
  neck: ["neck"],
  upperBack: ["lats", "middle back"],
  lowerBack: ["lower back"],
  gluteal: ["glutes", "abductors"],
  hamstring: ["hamstrings"],
};

const LEGEND: Record<BodyMode, [string, string, string]> = {
  volume: ["1 to 4 sets", "5 to 9", "10 or more"],
  recovery: ["", "2 days ago", "Today or yesterday"],
  untrained: ["A week", "Two weeks", "Not in 4 weeks"],
};

const sets = (n: number) => (n % 1 ? n.toFixed(1) : String(n));

/** What the map shows, in words: the muscles it colours, strongest first. Also what a screen reader hears. */
function words(ms: BodyMuscle[], mode: BodyMode, t: DayKey): string {
  const on = ms.filter((b) => bodyLevel(b, mode, t) > 0);
  const name = (b: BodyMuscle) => MUSCLES[b.muscle];
  if (mode === "volume") {
    const xs = on.sort((a, b) => b.sets - a.sets).map((b) => `${name(b)} ${sets(b.sets)}`);
    return xs.length ? `Sets in the last 7 days: ${xs.join(", ")}.` : "No sets in the last 7 days yet.";
  }
  if (mode === "recovery") {
    const ago = (b: BodyMuscle) => daysBetween(b.last!, t), when = (n: number) => (n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`);
    const xs = on.sort((a, b) => ago(a) - ago(b)).map((b) => `${name(b)} (${when(ago(b))})`);
    return xs.length ? `Still recovering: ${xs.join(", ")}. Everything else is ready.` : "Nothing trained in the last two days: every muscle is ready.";
  }
  if (!on.length) return "Every muscle was trained as a main one this week.";
  const never = on.filter((b) => !b.last).map(name), lately = on.filter((b) => b.last).sort((a, b) => (a.last! < b.last! ? -1 : 1));
  return [
    never.length ? `Not trained as a main muscle in 4 weeks: ${never.join(", ")}.` : "",
    lately.length ? `Not in a week or more: ${lately.map((b) => `${name(b)} (${daysBetween(b.last!, t)} days)`).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** One side of the body, its groups coloured by how strongly their muscles show. */
function Figure({ side, level, label }: { side: BodySide; level: (slug: string) => number | null; label: string }) {
  return (
    <svg className="bm-fig" viewBox={side.viewBox} aria-hidden="true" focusable="false" data-side={label}>
      {side.parts.map((p) => {
        const l = level(p.slug);
        return (
          <g key={p.slug} className={l == null ? "bm-body" : `bm-l${l}`} data-slug={p.slug}>
            {p.d.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** Progress → Muscles' body map, front and back: where the last 7 days' sets went, what's still recovering, or what's
 *  gone untrained. The outlines (MuscleMap, MIT) load the first time it opens. */
export function BodyMap({ muscles, t }: { muscles: BodyMuscle[]; t: DayKey }) {
  const [mode, setMode] = useState<BodyMode>("volume");
  const [body, setBody] = useState<{ front: BodySide; back: BodySide } | null>(null);
  useEffect(() => {
    let live = true;
    void import("@/data/bodyMap").then((m) => live && setBody(m.BODY));
    return () => {
      live = false;
    };
  }, []);
  const by = new Map(muscles.map((b) => [b.muscle, b]));
  const level = (slug: string) => {
    const ms = REGION[slug];
    return ms ? Math.max(...ms.map((m) => (by.get(m) ? bodyLevel(by.get(m)!, mode, t) : 0))) : null;
  };
  const said = words(muscles, mode, t), legend = LEGEND[mode];
  return (
    <section className="card bodymap" id="bodyMap" data-mode={mode} aria-labelledby="bodyMapH">
      <h2 className="title-sm" id="bodyMapH">
        Body map
      </h2>
      <SegmentedControl
        id="bodyMode"
        value={mode}
        label="What the body map shows"
        onChange={setMode}
        options={[
          ["volume", "Sets"],
          ["recovery", "Recovering"],
          ["untrained", "Not trained"],
        ]}
      />
      <div className="bm-figs" role="img" aria-label={said}>
        {body ? (
          <>
            <Figure side={body.front} level={level} label="front" />
            <Figure side={body.back} level={level} label="back" />
          </>
        ) : null}
      </div>
      <p className="legend">
        {legend.map((w, i) =>
          w ? (
            <span key={i}>
              <i className={`bm-l${i + 1}`} />
              {w}
            </span>
          ) : null,
        )}
      </p>
      <p className="note" id="bodyMapSaid" aria-hidden="true">
        {said}
      </p>
    </section>
  );
}
