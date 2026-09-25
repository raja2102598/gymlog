"use client";
import { useId } from "react";
import { TEMPLATES, type PlanTemplate } from "@/data/templates";

interface Props {
  onPick: (t: PlanTemplate) => void;
  id?: string;
  hidden?: boolean;
  /** While something else is under way, such as restoring a backup. */
  disabled?: boolean;
}

/** The plan templates, a card each: its name, what the week holds, and a button to use it. On a new account's first
 *  screen, and under Start from a template in the plan editor. */
export function TemplateList({ onPick, id, hidden, disabled }: Props) {
  const uid = useId();
  return (
    <ul className="tpl-list" id={id} hidden={hidden}>
      {TEMPLATES.map((t) => (
        <li className="tpl" key={t.id}>
          <div className="tpl-t">
            <h3 id={`${uid}${t.id}`}>{t.name}</h3>
            <p className="sub">{t.summary}</p>
          </div>
          {/* Named "Use this plan" and the plan's name, so each of the four buttons says which plan it is. */}
          <button type="button" className="btn btn-sm" id={`${uid}${t.id}-use`} data-template={t.id} aria-labelledby={`${uid}${t.id}-use ${uid}${t.id}`} disabled={disabled} onClick={() => onPick(t)}>
            Use this plan
          </button>
        </li>
      ))}
    </ul>
  );
}
