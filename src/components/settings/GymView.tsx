"use client";
import { X } from "lucide-react";
import { useLibrary } from "@/components/library/LibraryContext";
import { Group, NumField, Text } from "@/components/settings/parts";
import { SyncedInput } from "@/components/ui/SyncedField";
import { useGym } from "@/hooks/useGym";
import { plural } from "@/lib/format";
import { EQUIP_GROUPS, EQUIPMENT, equipText, type Equip, type Exercise } from "@/lib/library";
import { WEIGHT_LIMITS } from "@/lib/plan";
import type { Weights } from "@/lib/types";

type List = "always" | "never";
const LISTS: Record<List, { title: string; sub: string }> = {
  always: { title: "Always offer", sub: "Offered even when your gym hasn’t got what they’re listed with." },
  never: { title: "Never offer", sub: "Not offered, even when your gym has what they need." },
};

/** The bars beyond the barbell, and what the rest go up by, as My gym's weights list them. */
const BARS: [keyof Weights, string][] = [
  ["ezbar", "EZ bar (kg)"],
  ["trapbar", "Trap bar (kg)"],
  ["smith", "Smith machine (kg)"],
];
const STEPS: [keyof Weights, string][] = [
  ["dumbbell", "Dumbbells (kg)"],
  ["kettlebell", "Kettlebells (kg)"],
  ["machine", "Machines (kg)"],
  ["cable", "Cables (kg)"],
  ["band", "Bands (kg)"],
];

/** Plate weights typed separated by commas or spaces: positive numbers, no duplicates, heaviest first. */
const parsePlates = (s: string): number[] => [...new Set(s.split(/[,\s]+/).map((t) => parseFloat(t)).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => b - a);

/** What each kind of equipment can load, saved with the plan: each bar's weight and the gym's plates, for a lift's
 *  plates and warm-up sets, and what dumbbells, kettlebells, machines, cables and bands go up by. A lift goes up by
 *  what it's loaded with, unless it has a step of its own, and its suggested weights round to what that makes. */
function WeightsGroup() {
  const store = useGym();
  const w = store.weights(), [bLo, bHi] = WEIGHT_LIMITS.bar, [sLo, sHi] = WEIGHT_LIMITS.step;
  return (
    <Group title="Bars, plates and weights" id="gymWeights" open>
      <div className="pref-row pref-col">
        <Text id="gw_bars" title="Bars and plates" sub="What each bar weighs, loaded with the plates your gym has" />
        <div className="pref-goals">
          <NumField
            id="barKg"
            label="Barbell (kg)"
            value={store.plan.barKg}
            min={1}
            max={50}
            step={0.5}
            decimal
            onSave={(v) =>
              store.editPlan((p) => {
                p.barKg = Math.round(v * 2) / 2;
              })
            }
          />
          {BARS.map(([k, label]) => (
            <NumField key={k} id={`bar_${k}`} label={label} value={w[k]} min={bLo} max={bHi} step={0.5} decimal onSave={(v) => store.setWeight(k, v)} />
          ))}
          <label className="field wide" htmlFor="plateKgs">
            <span>Plates (kg), separated by commas</span>
            <SyncedInput
              id="plateKgs"
              inputMode="decimal"
              value={store.plan.plateKgs.join(", ")}
              onChange={(ev) => {
                const v = ev.target.value;
                store.editPlan((p) => {
                  p.plateKgs = parsePlates(v);
                });
              }}
            />
          </label>
        </div>
        <p className="note" id="gearMsg">
          For the plates in a set’s menu and a lift’s warm-up sets. A lift on a bar goes up by a pair of the smallest
          plate. {store.planMsg}
        </p>
      </div>
      <div className="pref-row pref-col">
        <Text id="gw_steps" title="Steps" sub="What the rest go up by: a lift adds its equipment’s step, unless it has one of its own, and its suggested weights round to it" />
        <div className="pref-goals">
          {STEPS.map(([k, label]) => (
            <NumField key={k} id={`step_${k}`} label={label} value={w[k]} min={sLo} max={sHi} step={0.25} decimal onSave={(v) => store.setWeight(k, v)} />
          ))}
        </div>
      </div>
    </Group>
  );
}

/** My gym: the equipment your gym has, so the exercise library, a swap's suggestions and a free-form workout offer
 *  lifts you can do, and lifts always or never offered whatever the equipment says. Each change saves with the
 *  plan. Lifts in the plan stay whatever it has; the plan editor says when one needs what isn't here. */
export function GymView({ onDone }: { onDone: () => void }) {
  const store = useGym();
  const library = useLibrary();
  const g = store.gym(), all = store.library(), can = all.filter((x) => store.canDo(x)).length;
  const uses = (e: Equip) => all.filter((x) => x.equip.includes(e)).length;
  const listed = (list: List) => g[list].map((id) => all.find((x) => x.id === id)).filter((x): x is Exercise => !!x);
  const add = (list: List) =>
    library({
      title: LISTS[list].title,
      many: true,
      everything: true,
      create: false,
      have: listed(list).map((x) => x.name),
      onPick: (xs) => store.showLifts(xs.map((x) => x.id), list),
    });
  return (
    <div className="screen">
      <section className="card">
        <div className="pe-head">
          <div className="sub" id="gymMsg" aria-live="polite">
            {store.planMsg}
          </div>
          <button className="btn btn-primary" id="gymDone" onClick={onDone}>
            Done
          </button>
        </div>
        <p id="gymCount" role="status">
          {can === all.length ? `The library offers all ${all.length} of its lifts.` : `The library offers ${can} of its ${all.length} lifts.`}
        </p>
        <p className="note">
          Those your gym has the equipment for, and those needing none. It’s saved with your plan, so every device offers
          the same. Lifts already in your plan stay, whatever the gym has.
        </p>
        <div className="pref-btns">
          <button className="btn btn-sm" id="gymAll" disabled={!g.off.length} onClick={() => store.setEquip(true)}>
            Select all
          </button>
          <button className="btn btn-sm" id="gymNone" disabled={g.off.length === Object.keys(EQUIPMENT).length} onClick={() => store.setEquip(false)}>
            Clear all
          </button>
        </div>
      </section>
      <ul className="list gym-list">
      {EQUIP_GROUPS.map((grp) => (
        <Group key={grp.name} title={grp.name} id={`gym_${grp.equip[0]}`} value={`${grp.equip.filter((e) => !g.off.includes(e) && uses(e)).length} of ${grp.equip.filter((e) => uses(e) || g.off.includes(e)).length}`} open>
          {/* Equipment no lift uses (the library's foam roller lifts are all stretches) isn't shown, unless it's off. */}
          {grp.equip.filter((e) => uses(e) || g.off.includes(e)).map((e) => {
            const on = !g.off.includes(e);
            return (
              <button
                key={e}
                type="button"
                className="pref-row pref-tap"
                role="switch"
                data-equip={e}
                aria-checked={on}
                aria-labelledby={`gq_${e}T`}
                aria-describedby={`gq_${e}D`}
                onClick={() => store.setEquip(!on, e)}
              >
                <Text id={`gq_${e}`} title={EQUIPMENT[e]} sub={`${plural(uses(e), "lift")} use it`} />
                <span className="switch" aria-hidden="true" />
              </button>
            );
          })}
        </Group>
      ))}
      <WeightsGroup />
      <Group title="Lifts" id="gymLifts" open>
        {(["always", "never"] as const).map((list) => (
          <div key={list} className="pref-row pref-col" id={`gym_${list}`}>
            <div className="pref-line">
              <Text id={`gl_${list}`} title={LISTS[list].title} sub={LISTS[list].sub} />
              <button className="btn btn-sm" data-gymadd={list} aria-describedby={`gl_${list}T`} onClick={() => add(list)}>
                Add…
              </button>
            </div>
            {listed(list).length ? (
              <ul className="gym-lifts">
                {listed(list).map((x) => (
                  <li key={x.id}>
                    <span className="pref-t">
                      <span className="pref-tt">{x.name}</span>
                      <span className="sub">{equipText(x)}</span>
                    </span>
                    <button className="btn btn-icon" data-gymrm={x.id} aria-label={`Take ${x.name} off ${LISTS[list].title}`} onClick={() => store.showLifts([x.id], null)}>
                      <X size={18} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </Group>
      </ul>
    </div>
  );
}
