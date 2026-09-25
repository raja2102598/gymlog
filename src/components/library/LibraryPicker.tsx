"use client";
import { X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useGym } from "@/hooks/useGym";
import { cx } from "@/lib/cx";
import { plural } from "@/lib/format";
import { customLift, EQUIPMENT, equipText, isEquip, isMuscle, muscleText, MUSCLES, searchLibrary, type Equip, type Exercise, type LibQuery, type Muscle } from "@/lib/library";

/** What the library is opened for. */
export interface LibraryAsk {
  /** Its title: "Add lifts to Legs", "Swap Leg Press for". */
  title: string;
  /** Several lifts at once, added with one button ("Add 3"), or one, picked with a tap. */
  many: boolean;
  /** Words to search for to begin with. */
  text?: string;
  /** A muscle to show the lifts of, to begin with. */
  muscle?: Muscle;
  /** A lift created here must have this name: a plan lift's, which stays as it is. */
  name?: string;
  /** Opens on the form for your own lift `name`, to give it its muscles and equipment. */
  edit?: boolean;
  /** Names already there: shown as added, not picked again. */
  have?: string[];
  onPick: (xs: Exercise[]) => void;
}

/** The exercise library, over the screen: search by name, filter by muscle and equipment, common lifts first, and a
 *  lift of your own made with Create. Closes on a pick, Close or Escape. */
export function LibraryPicker({ ask, onClose }: { ask: LibraryAsk | null; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (ask && !d.open) {
      d.showModal();
      // A keyboard is there already on a computer; on a phone the list shows first, under the search box.
      if (matchMedia("(pointer: fine)").matches) d.querySelector<HTMLInputElement>("#libSearch")?.focus();
    } else if (!ask && d.open) d.close();
  }, [ask]);
  // Closed here and now, not after the next render: while it's open, the page under it can't take focus, and a
  // pick moves focus there (the lift added, say).
  const close = () => {
    if (dlg.current?.open) dlg.current.close();
    else onClose();
  };
  return (
    <dialog ref={dlg} className="lib" id="libDialog" aria-labelledby="libTitle" onClose={onClose}>
      {ask ? <Picker ask={ask} onClose={close} /> : null}
    </dialog>
  );
}

const SHOWN = 60;

function Picker({ ask, onClose }: { ask: LibraryAsk; onClose: () => void }) {
  const store = useGym();
  const [q, setQ] = useState<LibQuery>({ text: ask.text ?? "", muscle: ask.muscle ?? "", equip: "", sort: "common" });
  const [chosen, setChosen] = useState<Exercise[]>([]);
  const [shown, setShown] = useState(SHOWN);
  const [making, setMaking] = useState(!!ask.edit);
  const have = new Set((ask.have ?? []).map((n) => n.toLowerCase()));
  const all = store.library(), found = searchLibrary(all, q);
  const set = (patch: Partial<LibQuery>) => {
    setQ({ ...q, ...patch });
    setShown(SHOWN);
  };
  const pick = (xs: Exercise[]) => {
    onClose();
    ask.onPick(xs);
  };
  const toggle = (x: Exercise) => setChosen(chosen.some((c) => c.id === x.id) ? chosen.filter((c) => c.id !== x.id) : [...chosen, x]);

  if (making)
    return (
      <CustomForm
        name={ask.name}
        start={ask.name ?? q.text ?? ""}
        onBack={() => setMaking(false)}
        onSaved={(x) => {
          setMaking(false);
          if (!ask.many) pick([x]);
          else setChosen([...chosen.filter((c) => c.id !== x.id), x]);
        }}
      />
    );
  return (
    <div className="lib-in">
      <div className="lib-head">
        <h2 id="libTitle">{ask.title}</h2>
        <button type="button" className="ghost icon" id="libClose" aria-label="Close the library" onClick={onClose}>
          <X size={20} weight="bold" aria-hidden="true" />
        </button>
      </div>
      <div className="lib-tools">
        <label className="field" htmlFor="libSearch">
          <span className="sr-only">Search the library</span>
          <input id="libSearch" type="search" placeholder={`Search ${all.length} lifts`} autoComplete="off" value={q.text} onChange={(ev) => set({ text: ev.target.value })} />
        </label>
        <div className="lib-filters">
          <select id="libMuscle" className="ghost tiny" aria-label="Muscle" value={q.muscle} onChange={(ev) => set({ muscle: isMuscle(ev.target.value) ? ev.target.value : "" })}>
            <option value="">All muscles</option>
            {(Object.keys(MUSCLES) as Muscle[]).map((m) => (
              <option key={m} value={m}>
                {MUSCLES[m]}
              </option>
            ))}
          </select>
          <select id="libEquip" className="ghost tiny" aria-label="Equipment" value={q.equip} onChange={(ev) => set({ equip: isEquip(ev.target.value) ? ev.target.value : "" })}>
            <option value="">All equipment</option>
            {(Object.keys(EQUIPMENT) as Equip[]).map((e) => (
              <option key={e} value={e}>
                {EQUIPMENT[e]}
              </option>
            ))}
          </select>
        </div>
        <div className="lib-count">
          <p className="sub" id="libCount" role="status">
            {found.length === all.length ? plural(all.length, "lift") : `${plural(found.length, "lift")} of ${all.length}`}
          </p>
          <select id="libSort" className="ghost tiny" aria-label="Order" value={q.sort} onChange={(ev) => set({ sort: ev.target.value === "az" ? "az" : "common" })}>
            <option value="common">Common first</option>
            <option value="az">A to Z</option>
          </select>
        </div>
      </div>
      <ul className="lib-list" id="libList">
        {found.slice(0, shown).map((x) => {
          const had = have.has(x.name.toLowerCase()), on = chosen.some((c) => c.id === x.id);
          const words = (
            <span className="lib-t">
              <span className="lib-n">
                {x.name}
                {x.custom ? <span className="lib-tag">Yours</span> : null}
                {had ? <span className="lib-tag">Added</span> : null}
              </span>
              <span className="sub">
                {equipText(x)} · {muscleText(x)}
              </span>
            </span>
          );
          return (
            <li key={x.id}>
              {ask.many ? (
                <label className={cx("lib-row", on && "on", had && "had")}>
                  <input type="checkbox" data-lib={x.id} checked={on || had} disabled={had} onChange={() => toggle(x)} />
                  {words}
                </label>
              ) : (
                <button type="button" className="lib-row" data-lib={x.id} disabled={had} onClick={() => pick([x])}>
                  {words}
                </button>
              )}
            </li>
          );
        })}
        {found.length > shown ? (
          <li>
            <button type="button" className="ghost tiny lib-more" id="libMore" onClick={() => setShown(shown + SHOWN * 2)}>
              Show {Math.min(SHOWN * 2, found.length - shown)} more
            </button>
          </li>
        ) : null}
        {found.length ? null : <li className="empty">Nothing matches. Create it as a lift of your own?</li>}
      </ul>
      <div className="lib-foot">
        <button type="button" className="ghost" id="libCreate" onClick={() => setMaking(true)}>
          Create a lift
        </button>
        {ask.many ? (
          <button type="button" className="primary" id="libAdd" disabled={!chosen.length} onClick={() => pick(chosen)}>
            {chosen.length ? `Add ${chosen.length}` : "Add"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** A lift of your own: its name, what it's done with and the muscles it works. `name` fixes the name, for a plan
 *  lift being given its muscles. */
function CustomForm({ name, start, onBack, onSaved }: { name?: string; start: string; onBack: () => void; onSaved: (x: Exercise) => void }) {
  const store = useGym();
  const own = name ? store.plan.custom?.find((c) => c.name.toLowerCase() === name.toLowerCase()) : undefined;
  const [msg, setMsg] = useState("");
  const [second, setSecond] = useState<Muscle[]>(own?.secondary ?? []);
  const save = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = ev.currentTarget.elements, val = (id: string) => (f.namedItem(id) as HTMLInputElement | HTMLSelectElement).value;
    const equip = val("libNewEquip"), main = val("libNewMuscle");
    const c = { name: val("libNewName").trim(), equip: isEquip(equip) ? [equip] : [], primary: isMuscle(main) ? [main] : [], secondary: second.filter((m) => m !== main) };
    const err = store.saveCustom(c, !!name);
    if (err) setMsg(err);
    else onSaved(customLift(c));
  };
  return (
    <form className="lib-in lib-new" id="libNew" onSubmit={save}>
      <div className="lib-head">
        <h2 id="libTitle">{name ? `${name}: your own lift` : "Create a lift"}</h2>
      </div>
      <div className="lib-body">
        <label className="field" htmlFor="libNewName">
          <span>Name</span>
          <input id="libNewName" name="libNewName" defaultValue={start} readOnly={!!name} required autoComplete="off" />
        </label>
        <label className="field" htmlFor="libNewEquip">
          <span>Equipment</span>
          <select id="libNewEquip" name="libNewEquip" className="ghost" defaultValue={own?.equip[0] ?? ""}>
            <option value="">None: bodyweight</option>
            {(Object.keys(EQUIPMENT) as Equip[]).map((e) => (
              <option key={e} value={e}>
                {EQUIPMENT[e]}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor="libNewMuscle">
          <span>Main muscle</span>
          <select id="libNewMuscle" name="libNewMuscle" className="ghost" defaultValue={own?.primary[0] ?? ""}>
            <option value="">Not sure</option>
            {(Object.keys(MUSCLES) as Muscle[]).map((m) => (
              <option key={m} value={m}>
                {MUSCLES[m]}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="lib-sec">
          <legend>Other muscles it works (optional)</legend>
          {(Object.keys(MUSCLES) as Muscle[]).map((m) => (
            <label key={m} className="lib-chip">
              <input type="checkbox" data-libsec={m} checked={second.includes(m)} onChange={(ev) => setSecond(ev.target.checked ? [...second, m] : second.filter((s) => s !== m))} />
              <span>{MUSCLES[m]}</span>
            </label>
          ))}
        </fieldset>
        {msg ? (
          <p className="warn" id="libNewMsg" role="alert">
            {msg}
          </p>
        ) : null}
      </div>
      <div className="lib-foot">
        <button type="button" className="ghost" id="libNewBack" onClick={onBack}>
          Back
        </button>
        <button type="submit" className="primary" id="libNewSave">
          Save
        </button>
      </div>
    </form>
  );
}
