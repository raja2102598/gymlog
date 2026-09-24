"use client";
import { useState, type InputHTMLAttributes } from "react";
import { useFocusNext } from "@/hooks/useFocusNext";
import { useGym } from "@/hooks/useGym";
import { cx } from "@/lib/cx";
import { DOW } from "@/lib/dates";
import { num } from "@/lib/format";
import type { Plan, PlanExercise } from "@/lib/types";
import { TemplateList } from "./TemplateList";

type LiftText = "name" | "sets" | "reps" | "cue" | "flag" | "step";

interface Props {
  /** Weekday open in the editor, 0 = Monday. */
  editDay: number;
  onEditDay: (i: number) => void;
  onDone: () => void;
}

// The fields here are left to the browser (defaultValue): each keystroke saves to the plan, and the
// fields are rebuilt only when lifts are added, moved or removed, or another day is opened.
export function PlanEditor({ editDay, onEditDay, onDone }: Props) {
  const store = useGym();
  const focusNext = useFocusNext();
  const [templates, setTemplates] = useState(false);
  const plan = store.plan, d = plan.days[editDay], last = d.exercises.length - 1, wd = DOW[editDay];
  const edit = (fn: (p: Plan) => void, shape = false) => store.editPlan(fn, shape);
  const setLift = (j: number, f: LiftText, v: string) =>
    edit((p) => {
      p.days[editDay].exercises[j][f] = v;
    });
  const move = (j: number, dir: number) =>
    edit((p) => {
      const xs = p.days[editDay].exercises;
      [xs[j], xs[j + dir]] = [xs[j + dir], xs[j]];
    }, true);
  const remove = (j: number) => {
    if (!confirm(`Remove ${d.exercises[j].name.trim() || "this lift"} from ${wd}? Days you’ve already logged keep it.`)) return;
    edit((p) => {
      p.days[editDay].exercises.splice(j, 1);
    }, true);
  };
  const add = () => {
    const j = d.exercises.length;
    edit((p) => {
      p.days[editDay].exercises.push({ name: "", sets: "3", reps: "10-12", cue: "", flag: "", step: "", knee: false });
    }, true);
    focusNext(`#pe_x${j}_name`);
  };

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
          {d.exercises.length ? null : <p className="empty">No lifts: this is a rest day. Add one to make it a gym day.</p>}
          <ol className="pe-list">
            {d.exercises.map((x, j) => (
              <li className="pe-ex" key={j}>
                <div className="pe-row">
                  {liftField(x, j, "name", `Lift ${j + 1}`, {
                    placeholder: "Exercise name…",
                    "aria-invalid": badName(names[j]) || undefined,
                    "aria-describedby": badName(names[j]) ? "peWarn" : undefined,
                  })}
                  {liftField(x, j, "sets", "Sets", { placeholder: "3" })}
                  {liftField(x, j, "reps", "Reps", { placeholder: "8-10" })}
                </div>
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
          <button className="ghost" id="pe_add" onClick={add}>
            + Add lift
          </button>
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
          Your history follows each lift by its name, so renaming a lift starts a fresh history for it. Days you’ve already logged keep what you logged.
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
