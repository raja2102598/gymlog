"use client";
import { X } from "@phosphor-icons/react";
import { useLibrary } from "@/components/library/LibraryContext";
import { Group, Text } from "@/components/settings/parts";
import { useGym } from "@/hooks/useGym";
import { plural } from "@/lib/format";
import { EQUIP_GROUPS, EQUIPMENT, equipText, type Equip, type Exercise } from "@/lib/library";

type List = "always" | "never";
const LISTS: Record<List, { title: string; sub: string }> = {
  always: { title: "Always offer", sub: "Offered even when your gym hasn’t got what they’re listed with." },
  never: { title: "Never offer", sub: "Not offered, even when your gym has what they need." },
};

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
    <>
      <section className="panel">
        <div className="top pe-head">
          <div className="sub" id="gymMsg" aria-live="polite">
            {store.planMsg}
          </div>
          <button className="primary" id="gymDone" onClick={onDone}>
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
          <button className="ghost" id="gymAll" disabled={!g.off.length} onClick={() => store.setEquip(true)}>
            Select all
          </button>
          <button className="ghost" id="gymNone" disabled={g.off.length === Object.keys(EQUIPMENT).length} onClick={() => store.setEquip(false)}>
            Clear all
          </button>
        </div>
      </section>
      {EQUIP_GROUPS.map((grp) => (
        <Group key={grp.name} title={grp.name} id={`gym_${grp.equip[0]}`}>
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
      <Group title="Lifts" id="gymLifts">
        {(["always", "never"] as const).map((list) => (
          <div key={list} className="pref-row pref-col" id={`gym_${list}`}>
            <div className="pref-line">
              <Text id={`gl_${list}`} title={LISTS[list].title} sub={LISTS[list].sub} />
              <button className="ghost" data-gymadd={list} aria-describedby={`gl_${list}T`} onClick={() => add(list)}>
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
                    <button className="ghost icon" data-gymrm={x.id} aria-label={`Take ${x.name} off ${LISTS[list].title}`} onClick={() => store.showLifts([x.id], null)}>
                      <X size={18} weight="bold" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </Group>
    </>
  );
}
