"use client";
import { CaretDown } from "@phosphor-icons/react";
import { useState, type InputHTMLAttributes } from "react";
import { useFocusNext } from "@/hooks/useFocusNext";
import { useGym } from "@/hooks/useGym";
import { useLibrary } from "@/components/library/LibraryContext";
import { cx } from "@/lib/cx";
import { DOW } from "@/lib/dates";
import { num } from "@/lib/format";
import { equipText, equipWords, muscleText, type Exercise } from "@/lib/library";
import { planBlocks } from "@/lib/plan";
import type { ProgRule } from "@/lib/stats";
import type { Plan, PlanExercise } from "@/lib/types";
import { TemplateList } from "./TemplateList";

type LiftText = "name" | "sets" | "reps" | "cue" | "flag" | "step" | "rest" | "oneRm" | "pct" | "deloadAfter" | "deloadPct";

/** Each progression rule's name, and what it does, under the choice. */
const PROG: Record<ProgRule, [string, string]> = {
  double: ["Double progression", "Every set at the top of the rep range, then add the step."],
  linear: ["Linear", "Add the step every session each set reaches the bottom of the rep range."],
  percent: ["% of 1RM", "Work at a percentage of a 1RM you enter, to the nearest step."],
};

interface Props {
  /** Weekday open in the editor, 0 = Monday. */
  editDay: number;
  onEditDay: (i: number) => void;
  onDone: () => void;
}

/** A lift joined to the one before it as a superset, or not: left out rather than false when not, as the plan
 *  keeps it (PlanExercise.superset). */
function joined(x: PlanExercise, on: boolean): PlanExercise {
  const y = { ...x };
  if (on) y.superset = true;
  else delete y.superset;
  return y;
}

// The fields here are left to the browser (defaultValue): each keystroke saves to the plan, and the
// fields are rebuilt only when lifts are added, moved or removed, or another day is opened.
export function PlanEditor({ editDay, onEditDay, onDone }: Props) {
  const store = useGym();
  const focusNext = useFocusNext();
  const library = useLibrary();
  const [templates, setTemplates] = useState(false);
  const [renameMsg, setRenameMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  // Cleared on its own when another day opens, rather than lingering under a lift it no longer names.
  const [renameDay, setRenameDay] = useState(editDay);
  if (renameDay !== editDay) {
    setRenameDay(editDay);
    setRenameMsg(null);
  }
  const plan = store.plan, d = plan.days[editDay], last = d.exercises.length - 1, wd = DOW[editDay];
  const edit = (fn: (p: Plan) => void, shape = false) => store.editPlan(fn, shape);
  // A lift given a name that is a library lift's or one of your own is that lift: its link to another goes.
  const setLift = (j: number, f: LiftText, v: string) =>
    edit((p) => {
      const x = p.days[editDay].exercises[j];
      x[f] = v;
      if (f === "name" && store.namesALift(v)) delete x.lib;
    });
  // Up and Down keep a superset whole: within one, a lift trades places with its neighbour and the superset stays
  // as it was; otherwise the lift, or its whole superset, moves past the next lift or superset.
  const move = (j: number, dir: -1 | 1) =>
    edit((p) => {
      const xs = p.days[editDay].exercises, blocks = planBlocks(xs);
      const b = blocks.findIndex((bl) => bl.includes(xs[j])), bl = blocks[b], at = bl.indexOf(xs[j]);
      if (bl[at + dir]) [bl[at], bl[at + dir]] = [bl[at + dir], bl[at]];
      else if (blocks[b + dir]) [blocks[b], blocks[b + dir]] = [blocks[b + dir], blocks[b]];
      xs.splice(0, xs.length, ...blocks.flatMap((bl) => bl.map((x, n) => joined(x, n > 0))));
    }, true);
  const remove = (j: number) => {
    if (!confirm(`Remove ${d.exercises[j].name.trim() || "this lift"} from ${wd}? Days you’ve already logged keep it.`)) return;
    edit((p) => {
      const xs = p.days[editDay].exercises;
      // The first lift of a superset leaves the next one first, rather than joining the lift before.
      if (!xs[j].superset && xs[j + 1]) xs[j + 1] = joined(xs[j + 1], false);
      xs.splice(j, 1);
    }, true);
  };
  // Double progression is the default, so it's left out of the plan rather than stored. A 1RM and percentage stay
  // when another rule is picked, ready for switching back.
  const setProg = (j: number, v: string) =>
    edit((p) => {
      const x = p.days[editDay].exercises[j];
      if (v === "linear" || v === "percent") x.prog = v;
      else delete x.prog;
    });
  const setSuperset = (j: number, on: boolean) =>
    edit((p) => {
      const xs = p.days[editDay].exercises;
      xs[j] = joined(xs[j], on);
    });
  const add = () => {
    const j = d.exercises.length;
    edit((p) => {
      p.days[editDay].exercises.push({ name: "", sets: "3", reps: "10-12", cue: "", flag: "", step: "", knee: false, rest: "" });
    }, true);
    focusNext(`#pe_x${j}_name`);
  };
  // Lifts from the exercise library, after the day's others; the first one's name takes focus. A lift on the day
  // shows as added under its own name and the library's.
  const addFromLibrary = () =>
    library({
      title: `Add lifts to ${d.name}`,
      many: true,
      have: d.exercises.flatMap((x) => [x.name, store.exerciseOf(x.name, x)?.name ?? x.name]),
      onPick: (xs) => {
        const j = d.exercises.length;
        store.addLibraryLifts(editDay, xs);
        focusNext(`#pe_x${j}_name`);
      },
    });
  // A plan lift's library lift: picked (or one of your own made) for it. A lift with no name yet takes the pick's.
  // One of your own opens on its form (`own`), for its muscles.
  const findInLibrary = (name: string, j?: number, own = false) =>
    library({
      title: name ? `${name} in the library` : "Pick from the library",
      many: false,
      text: name,
      name: name || undefined,
      edit: own && !!name,
      onPick: ([x]: Exercise[]) => {
        if (name) store.linkLift(name, x);
        else if (j != null)
          edit((p) => {
            const y = p.days[editDay].exercises[j];
            y.name = x.name;
            if (!x.custom) y.lib = x.id;
          }, true);
        if (j != null) focusNext(`[data-plib="${j}"]`);
      },
    });
  // Offered when a name that has history is changed and the field is left, never on every keystroke: carries
  // every logged day (and any swap) over to the new name, and every other plan day still using the old one,
  // since a lift kept on two days (Seated Row on Pull and Upper) shares one history. Declining, or a name with
  // no history to lose, just leaves the plain rename as typed: a fresh history starts, as the note below says.
  const tryCarryOver = async (j: number, before: string, afterRaw: string) => {
    setRenameMsg(null);
    const from = before.trim(), to = afterRaw.trim();
    if (!from || !to || from === to || !store.hasHistory(from)) return;
    if (d.exercises.some((ex, k) => k !== j && ex.name.trim() === to)) {
      setRenameMsg({ warn: true, text: `Another lift on ${wd} is already called “${to}”. Give them different names to carry ${from}’s history over.` });
      return;
    }
    if (store.hasHistory(to)) {
      setRenameMsg({ warn: true, text: `“${to}” already has its own history, so ${from}’s can’t be carried over there too.` });
      return;
    }
    if (!confirm(`Carry ${from}’s history over to ${to}? Every logged day, and anything swapped for ${from}, will show ${to} instead.`)) return;
    setRenameMsg({ text: `Carrying ${from}’s history over to ${to}…` });
    const r = await store.renameLift(from, to);
    setRenameMsg({ warn: !r.ok, text: r.msg });
  };

  const questions = store.libraryQuestions();
  // Each superset's letter (A, B, …) and each lift's place in it (A1, A2), for the lifts in one.
  const tags: string[] = [];
  planBlocks(d.exercises.map((x, j) => ({ ...x, j })))
    .filter((bl) => bl.length > 1)
    .forEach((bl, n) => bl.forEach((x, k) => (tags[x.j] = `${String.fromCharCode(65 + n)}${k + 1}`)));
  const names = d.exercises.map((x) => x.name.trim()), dup = names.find((n, i) => n && names.indexOf(n) !== i);
  // A name box that's empty or repeated is marked, and the message says what to do.
  const badName = (n: string) => !n || names.indexOf(n) !== names.lastIndexOf(n);
  const warn = names.some((n) => !n)
    ? "Lifts without a name aren’t saved. Give each one a name."
    : dup
      ? `Two lifts are called “${dup}”. Rename one so their logs stay separate.`
      : "";

  const liftField = (x: PlanExercise, j: number, f: LiftText, label: string, extra: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field" htmlFor={`pe_x${j}_${f}`}>
      <span>{label}</span>
      <input id={`pe_x${j}_${f}`} data-px={`${j}:${f}`} defaultValue={x[f]} autoComplete="off" onChange={(ev) => setLift(j, f, ev.target.value)} {...extra} />
    </label>
  );
  // The name field on its own, not through liftField: it needs the name at focus, to offer carrying its
  // history over once the field is left, which none of the other fields do.
  const nameField = (x: PlanExercise, j: number) => (
    <label className="field" htmlFor={`pe_x${j}_name`}>
      <span>
        {`Lift ${j + 1}`}
        {tags[j] ? <span className="pe-sstag">{` · superset ${tags[j]}`}</span> : null}
      </span>
      <input
        id={`pe_x${j}_name`}
        data-px={`${j}:name`}
        defaultValue={x.name}
        autoComplete="off"
        placeholder="Exercise name…"
        aria-invalid={badName(names[j]) || undefined}
        aria-describedby={badName(names[j]) ? "peWarn" : undefined}
        onFocus={(ev) => {
          ev.currentTarget.dataset.prev = ev.currentTarget.value;
        }}
        onChange={(ev) => setLift(j, "name", ev.target.value)}
        onBlur={(ev) => void tryCarryOver(j, ev.currentTarget.dataset.prev ?? "", ev.currentTarget.value)}
      />
    </label>
  );

  return (
    <>
      <section className="panel">
        {/* The bar above names the page; this says whether it's saved. */}
        <div className="top pe-head">
          <div className="sub" id="planMsg" aria-live="polite">
            {store.planMsg}
          </div>
          <button className="primary" id="planDone" onClick={onDone}>
            Done
          </button>
        </div>
        <div className="week" id="planDays">
          {plan.days.map((p, i) => (
            <button key={i} className={cx("dchip", i === editDay && "sel")} aria-label={`Edit ${DOW[i]}, ${p.name}`} aria-pressed={i === editDay} onClick={() => onEditDay(i)}>
              <span className="dw">{DOW[i]}</span>
              <span className="dp">{p.name}</span>
            </button>
          ))}
        </div>
        {questions.length ? (
          <div className="pe-match" id="peMatch" role="group" aria-labelledby="peMatchH">
            <h3 className="pe-h" id="peMatchH">
              Lifts the library may know
            </h3>
            <p className="note">Say once whether each is the same lift, so its muscles and equipment are known. It keeps its name and its history either way.</p>
            <ul>
              {questions.slice(0, 4).map((q) => (
                <li key={q.name} data-match={q.name}>
                  <p>
                    <b>{q.name}</b>: the same as <b>{q.like[0].name}</b>?{" "}
                    <span className="sub">
                      {equipText(q.like[0])} · {muscleText(q.like[0])}
                    </span>
                  </p>
                  <div className="pe-btns">
                    <button className="ghost tiny" data-same={q.name} onClick={() => store.linkLift(q.name, q.like[0])}>
                      Same lift
                    </button>
                    <button className="ghost tiny" data-another={q.name} onClick={() => findInLibrary(q.name)}>
                      Another one…
                    </button>
                    <button className="ghost tiny" data-mine={q.name} onClick={() => store.keepOwn(q.name)}>
                      It’s my own
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {questions.length > 4 ? <p className="note">{questions.length - 4} more after these.</p> : null}
          </div>
        ) : null}
        <div id="planDay" key={`${editDay}:${store.planShape}`}>
          <div className="pe-grid">
            <label className="field" htmlFor="pe_name">
              <span>{wd} session name</span>
              <input
                id="pe_name"
                defaultValue={d.name}
                placeholder="e.g. Push…"
                autoComplete="off"
                onChange={(ev) => {
                  const v = ev.target.value;
                  edit((p) => {
                    p.days[editDay].name = v;
                  });
                }}
              />
            </label>
            <label className="field" htmlFor="pe_focus">
              <span>Focus</span>
              <input
                id="pe_focus"
                defaultValue={d.focus}
                placeholder="e.g. Chest / Shoulders…"
                autoComplete="off"
                onChange={(ev) => {
                  const v = ev.target.value;
                  edit((p) => {
                    p.days[editDay].focus = v;
                  });
                }}
              />
            </label>
          </div>
          <h3 className="pe-h">Lifts</h3>
          <div id="peWarn" role="status">
            {warn ? <p className="warn">{warn}</p> : null}
          </div>
          <div id="peRename" role="status">
            {renameMsg ? <p className={renameMsg.warn ? "warn" : "note"}>{renameMsg.text}</p> : null}
          </div>
          {d.exercises.length ? null : <p className="empty">No lifts: this is a rest day. Add one to make it a gym day.</p>}
          <ol className="pe-list">
            {d.exercises.map((x, j) => (
              <li className={cx("pe-ex", tags[j] && "ss", x.superset && "ss-join")} key={j}>
                <div className="pe-row">
                  {nameField(x, j)}
                  {liftField(x, j, "sets", "Sets", { placeholder: "3" })}
                  {liftField(x, j, "reps", "Reps", { placeholder: "8-10" })}
                </div>
                <LibLine x={x} j={j} onFind={(own) => findInLibrary(x.name.trim(), j, own)} />
                <label className="field" htmlFor={`pe_x${j}_cue`}>
                  <span>How to do it</span>
                  <textarea id={`pe_x${j}_cue`} data-px={`${j}:cue`} rows={2} defaultValue={x.cue} autoComplete="off" onChange={(ev) => setLift(j, "cue", ev.target.value)} />
                </label>
                {liftField(x, j, "flag", "Warning note (optional)", { placeholder: "e.g. KNEE NOTE: pain-free range only…" })}
                <div className="pe-row2">
                  {liftField(x, j, "step", "Add per increase (kg)", { placeholder: "2.5", inputMode: "decimal" })}
                  <label className="pe-check" htmlFor={`pe_x${j}_knee`}>
                    <input
                      type="checkbox"
                      id={`pe_x${j}_knee`}
                      data-pknee={j}
                      checked={x.knee}
                      onChange={(ev) => {
                        const on = ev.target.checked;
                        edit((p) => {
                          p.days[editDay].exercises[j].knee = on;
                        });
                      }}
                    />{" "}
                    Knee-sensitive
                  </label>
                </div>
                <div className="pe-row2">
                  {liftField(x, j, "rest", "Rest after a set (seconds, optional)", { placeholder: `Plan default (${plan.restSec})`, inputMode: "numeric" })}
                  {j > 0 ? (
                    <label className="pe-check" htmlFor={`pe_x${j}_ss`}>
                      <input type="checkbox" id={`pe_x${j}_ss`} data-pss={j} checked={!!x.superset} onChange={(ev) => setSuperset(j, ev.target.checked)} /> Superset with{" "}
                      {names[j - 1] || "the lift above"}
                    </label>
                  ) : null}
                </div>
                <details className="pe-prog">
                  <summary>
                    <span>
                      Progression: {PROG[x.prog ?? "double"][0]}
                      {parseInt(x.deloadAfter ?? "", 10) > 0 ? `, deload after ${parseInt(x.deloadAfter ?? "", 10)} short` : ""}
                    </span>
                    <CaretDown size={14} weight="bold" aria-hidden="true" />
                  </summary>
                  <label className="field" htmlFor={`pe_x${j}_prog`}>
                    <span>How the weight goes up</span>
                    <select id={`pe_x${j}_prog`} data-pprog={j} value={x.prog ?? "double"} aria-describedby={`pe_x${j}_proghow`} onChange={(ev) => setProg(j, ev.target.value)}>
                      {Object.entries(PROG).map(([k, [label]]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="sub" id={`pe_x${j}_proghow`}>
                    {PROG[x.prog ?? "double"][1]}
                  </p>
                  {x.prog === "percent" ? (
                    <div className="pe-row2">
                      {liftField(x, j, "oneRm", "1RM (kg)", { placeholder: "e.g. 100", inputMode: "decimal" })}
                      {liftField(x, j, "pct", "Work at (% of 1RM)", { placeholder: "e.g. 75", inputMode: "decimal" })}
                    </div>
                  ) : null}
                  <div className="pe-row2">
                    {liftField(x, j, "deloadAfter", "Deload after (sessions short)", { placeholder: "Off", inputMode: "numeric" })}
                    {liftField(x, j, "deloadPct", "Deload by (%)", { placeholder: "10", inputMode: "decimal" })}
                  </div>
                  <p className="sub">A deload takes weight off once that many sessions in a row fall short of the sets and reps.</p>
                </details>
                <div className="pe-btns">
                  <button className="ghost tiny" data-pmove={`${j}:-1`} disabled={j === 0} aria-label={`Move lift ${j + 1} up`} onClick={() => move(j, -1)}>
                    ↑ Up
                  </button>
                  <button className="ghost tiny" data-pmove={`${j}:1`} disabled={j === last} aria-label={`Move lift ${j + 1} down`} onClick={() => move(j, 1)}>
                    ↓ Down
                  </button>
                  <button className="ghost tiny danger" data-pdel={j} onClick={() => remove(j)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <div className="pe-btns">
            <button className="ghost" id="pe_add" onClick={add}>
              + Add lift
            </button>
            <button className="ghost" id="pe_lib" onClick={addFromLibrary}>
              + From the library
            </button>
          </div>
          <h3 className="pe-h">Cardio finisher</h3>
          <div className="pe-stack">
            <label className="field" htmlFor="pe_cname">
              <span>Name</span>
              <input
                id="pe_cname"
                defaultValue={d.cardio.name}
                placeholder="e.g. Cycling - 15-20 min…"
                autoComplete="off"
                onChange={(ev) => {
                  const v = ev.target.value;
                  edit((p) => {
                    p.days[editDay].cardio.name = v;
                  });
                }}
              />
            </label>
            <label className="field" htmlFor="pe_cdetail">
              <span>Details</span>
              <textarea
                id="pe_cdetail"
                rows={2}
                autoComplete="off"
                defaultValue={d.cardio.detail}
                onChange={(ev) => {
                  const v = ev.target.value;
                  edit((p) => {
                    p.days[editDay].cardio.detail = v;
                  });
                }}
              />
            </label>
          </div>
        </div>
      </section>
      <section className="panel" id="planGeneral" key={store.planShape}>
        <h2>Every day</h2>
        <div className="pe-grid">
          <label className="field" htmlFor="pe_goal">
            <span>Daily step goal</span>
            <input
              id="pe_goal"
              type="number"
              autoComplete="off"
              inputMode="numeric"
              min="1"
              step="500"
              defaultValue={plan.stepGoal}
              onChange={(ev) => {
                const v = Math.round(+ev.target.value);
                if (v > 0)
                  edit((p) => {
                    p.stepGoal = v;
                  });
              }}
            />
          </label>
          <label className="field" htmlFor="pe_tempo">
            <span>Lift tempo</span>
            <input
              id="pe_tempo"
              defaultValue={plan.tempo}
              placeholder="3:1:2:1"
              autoComplete="off"
              onChange={(ev) => {
                const v = ev.target.value;
                edit((p) => {
                  p.tempo = v;
                });
              }}
            />
          </label>
        </div>
        <div className="pe-grid">
          <label className="field" htmlFor="pe_goalw">
            <span>Goal weight (kg)</span>
            <input
              id="pe_goalw"
              type="number"
              autoComplete="off"
              inputMode="decimal"
              min="0"
              step="0.1"
              defaultValue={plan.goalWeight ?? ""}
              placeholder="optional"
              onChange={(ev) => {
                const v = num(ev.target.value);
                edit((p) => {
                  p.goalWeight = v != null && v > 0 ? v : null;
                });
              }}
            />
          </label>
          <label className="field" htmlFor="pe_rate">
            <span>Target loss a week (% of body weight)</span>
            <input
              id="pe_rate"
              type="number"
              autoComplete="off"
              inputMode="decimal"
              min="0"
              step="0.1"
              defaultValue={plan.weeklyRatePct ?? ""}
              placeholder="optional, e.g. 0.7"
              onChange={(ev) => {
                const v = num(ev.target.value);
                edit((p) => {
                  p.weeklyRatePct = v != null && v > 0 ? v : null;
                });
              }}
            />
          </label>
          <label className="field" htmlFor="pe_klim">
            <span>Knee pain limit (0 to 10)</span>
            <input
              id="pe_klim"
              type="number"
              autoComplete="off"
              inputMode="numeric"
              min="0"
              max="10"
              step="1"
              defaultValue={plan.kneeLimit}
              onChange={(ev) => {
                const v = num(ev.target.value);
                if (v != null && Number.isInteger(v) && v >= 0 && v <= 10)
                  edit((p) => {
                    p.kneeLimit = v;
                  });
              }}
            />
          </label>
        </div>
        <label className="field" htmlFor="pe_warm">
          <span>Warm-ups, one per line</span>
          <textarea
            id="pe_warm"
            rows={7}
            autoComplete="off"
            defaultValue={plan.warmups.join("\n")}
            onChange={(ev) => {
              const v = ev.target.value;
              edit((p) => {
                p.warmups = [...new Set(v.split("\n").map((s) => s.trim()).filter(Boolean))];
              });
            }}
          />
        </label>
        <p className="note">
          Your history follows each lift by its name. Change a name with history and leave the field, and you’re asked whether to carry it over to the new name; say no, or rename one with no history, and it starts fresh. Days you’ve already logged keep what you logged either way.
        </p>
        <div className="pe-btns">
          <button className="ghost" id="pe_tpl" aria-expanded={templates} aria-controls="peTemplates" onClick={() => setTemplates(!templates)}>
            Start from a template
          </button>
          <button
            className="ghost danger"
            id="pe_reset"
            onClick={() => {
              if (confirm("Replace your plan with the default plan? Days you’ve already logged are kept.")) store.resetPlan();
            }}
          >
            Reset to the default plan
          </button>
        </div>
        <TemplateList
          id="peTemplates"
          hidden={!templates}
          onPick={(t) => {
            if (!confirm(`Replace your sessions, lifts, warm-ups and tempo with “${t.name}”? Your goals and the days you’ve already logged are kept.`)) return;
            setTemplates(false);
            store.startFrom(t.plan);
          }}
        />
      </section>
    </>
  );
}

/** What the exercise library knows of a plan lift: its equipment and muscles, what it needs that My gym hasn't got,
 *  and a way to pick another, or to give one of your own its muscles (`onFind(true)`). */
function LibLine({ x, j, onFind }: { x: PlanExercise; j: number; onFind: (own: boolean) => void }) {
  const store = useGym();
  const ex = store.exerciseOf(x.name, x), lacks = ex ? store.lacks(ex) : [];
  const what = !ex
    ? "Not in the library yet"
    : ex.custom
      ? ex.primary.length
        ? `Your own lift · ${equipText(ex)} · ${muscleText(ex)}`
        : "Your own lift · no muscles given yet"
      : `${ex.name.toLowerCase() === x.name.trim().toLowerCase() ? "" : `${ex.name} · `}${equipText(ex)} · ${muscleText(ex)}`;
  return (
    <div className="pe-lib">
      <span className="sub" id={`pe_x${j}_lib`}>
        {what}
      </span>
      <button className="ghost tiny" data-plib={j} aria-describedby={`pe_x${j}_lib`} onClick={() => onFind(!!ex?.custom)}>
        {ex ? (ex.custom ? "Muscles…" : "Change…") : "Find in library…"}
      </button>
      {lacks.length ? (
        <span className="pe-gym" id={`pe_x${j}_gym`}>
          My gym has no {equipWords(lacks)}.
        </span>
      ) : null}
    </div>
  );
}
