"use client";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/cx";

/** One of a question's answers: its button's words, and how it looks (the main answer filled, one that loses
 *  something in the warning colour). Cancel is always there as well, last. */
export interface Choice {
  id: string;
  label: string;
  tone?: "primary" | "danger" | "plain";
}
interface Question {
  title: string;
  body?: string;
  choices: Choice[];
  resolve: (id: string | null) => void;
}

let show: ((q: Question) => void) | null = null;

/**
 * Asks in the app's own sheet (AskHost, mounted once by GymLog) rather than the phone's plain system dialog: the
 * question, a line more if needed, its answers and Cancel. Resolves with the id picked, or null for Cancel, Back,
 * Escape or a tap outside it. Without the host (nothing mounted yet), the browser's own confirm stands in.
 */
export function choose(title: string, choices: Choice[], body?: string): Promise<string | null> {
  if (!show) return Promise.resolve(typeof confirm === "function" && confirm([title, body].filter(Boolean).join("\n\n")) ? choices[0].id : null);
  const open = show;
  return new Promise((resolve) => open({ title, body, choices, resolve }));
}

/** A yes-or-no question: true for `ok` (a thing lost, `danger`, shows in the warning colour). */
export async function ask(title: string, ok = "OK", { body, danger = false }: { body?: string; danger?: boolean } = {}): Promise<boolean> {
  return (await choose(title, [{ id: "ok", label: ok, tone: danger ? "danger" : "primary" }], body)) === "ok";
}

/** The sheet choose() and ask() open: from the bottom on a phone, its answers full width under the question. */
export function AskHost() {
  const [q, setQ] = useState<(Question & { n: number }) | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const count = useRef(0);
  useEffect(() => {
    show = (next) =>
      setQ((cur) => {
        cur?.resolve(null); // a question asked over another: the first is let go, unanswered
        return { ...next, n: ++count.current };
      });
    return () => {
      show = null;
    };
  }, []);
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (q && !d.open) d.showModal();
    else if (!q && d.open) d.close();
  }, [q]);
  const answer = (id: string | null) => {
    if (!q) return;
    setQ(null);
    q.resolve(id);
  };
  return (
    <dialog
      ref={dlg}
      className="ask"
      id="askDialog"
      aria-labelledby="askTitle"
      aria-describedby={q?.body ? "askBody" : undefined}
      // A plain yes or no, which the browser tests answer the way they did the system dialog's.
      data-confirm={q && q.choices.length === 1 ? "" : undefined}
      onClose={() => answer(null)}
      // A tap on the dimmed page around it (the dialog itself, outside its box) is Cancel.
      onClick={(ev) => ev.target === ev.currentTarget && answer(null)}
    >
      {q ? (
        <div className="ask-in" key={q.n}>
          <h2 className="ask-t" id="askTitle">
            {q.title}
          </h2>
          {q.body ? (
            <p className="ask-b" id="askBody">
              {q.body}
            </p>
          ) : null}
          <div className="ask-btns">
            {q.choices.map((c) => (
              <button key={c.id} type="button" className={cx("btn btn-block btn-lg", c.tone === "danger" ? "btn-danger" : c.tone !== "plain" && "btn-primary")} data-choice={c.id} onClick={() => answer(c.id)}>
                {c.label}
              </button>
            ))}
            <button type="button" className="btn btn-block btn-lg btn-quiet" id="askCancel" onClick={() => answer(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
