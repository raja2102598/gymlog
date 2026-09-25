"use client";
import { Dumbbell } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { thumbUrl } from "@/lib/exerciseMedia";

/** A lift's small picture in a list, 40px square like the icon tiles: its photo when the library has one, else
 *  `fallback` (an icon tile) for one of your own, one the library has no photo of, or while offline on the website.
 *  Decorative: the lift's name is always beside it. */
export function ExerciseThumb({ id, fallback, className }: { id: string | null | undefined; fallback?: ReactNode; className?: string }) {
  const src = thumbUrl(id);
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src)
    return (
      fallback ?? (
        <span className={cx("ico-tile", className)} aria-hidden="true">
          <Dumbbell size={20} />
        </span>
      )
    );
  // eslint-disable-next-line @next/next/no-img-element -- a static export has no image optimiser; the file is already small
  return <img className={cx("ex-thumb", className)} src={src} alt="" width={40} height={40} loading="lazy" decoding="async" onError={() => setFailed(src)} />;
}
