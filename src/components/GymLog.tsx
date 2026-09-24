"use client";
import { useEffect, useState } from "react";
import { useFocusNext } from "@/hooks/useFocusNext";
import { useGym } from "@/hooks/useGym";
import { addDays, todayKey, wdIndex } from "@/lib/dates";
import type { DayKey } from "@/lib/types";
import { DashboardView } from "./dashboard/DashboardView";
import { PlanEditor } from "./plan/PlanEditor";
import { AppMenu } from "./shell/AppMenu";
import { BootView } from "./shell/BootView";
import { LoginView } from "./shell/LoginView";
import { SetupView } from "./shell/SetupView";
import { SyncBar } from "./shell/SyncBar";
import { TodayView } from "./today/TodayView";
import type { KneeEdit, LiftMenu } from "./today/types";

type View = "day" | "dash" | "plan";

/** A text box has focus, so the page shouldn't move under the person typing. */
const editing = () => {
  const a = document.activeElement;
  return !!a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && (a as HTMLInputElement).type !== "checkbox"));
};

// Home-screen shortcuts (public/manifest.webmanifest) open /?go=today, weight or steps.
const shortcut = () => (typeof location === "undefined" ? null : new URL(location.href).searchParams.get("go"));

/** The app: Today, the dashboard and the plan editor, behind sign-in. The data lives in the store
 *  (lib/store.ts); this keeps what's on screen: the view, the selected day and what's unfolded. */
export default function GymLog() {
  const store = useGym();
  const focusNext = useFocusNext();
  const [view, setView] = useState<View>("day");
  const [sel, setSel] = useState<DayKey>(todayKey);
  const [menu, setMenu] = useState<LiftMenu | null>(null);
  const [warmOpen, setWarmOpen] = useState<DayKey | null>(null);
  const [kneeEdit, setKneeEdit] = useState<KneeEdit>({ day: null, fields: [] });
  const [editDay, setEditDay] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [, setToday] = useState(todayKey);
  const [go] = useState(shortcut);

  // Each sign-in starts on Today.
  const uid = store.user?.id ?? null;
  const [uiFor, setUiFor] = useState<string | null>(null);
  if (uid !== uiFor) {
    setUiFor(uid);
    setView("day");
    setMenu(null);
    setMenuOpen(false);
  }

  useEffect(() => store.start(), [store]);

  // The offline copy: out/sw.js, written by scripts/build-sw.mjs after each build.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const register = () => void navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  // A shortcut opens Today at the weight or steps field, then drops ?go= from the address.
  const signedIn = store.auth === "signedIn";
  useEffect(() => {
    if (!signedIn || !go || !new URL(location.href).searchParams.has("go")) return;
    const u = new URL(location.href);
    u.searchParams.delete("go");
    history.replaceState(null, "", u.pathname + u.search + u.hash);
    if (go === "weight" || go === "steps") focusNext(`#${go}`, true);
  }, [signedIn, go, focusNext]);

  // Roll the date over if the app stays open past midnight.
  useEffect(() => {
    const id = setInterval(() => {
      const t = todayKey();
      setToday(t);
      if (view === "day" && sel !== t && sel === addDays(t, -1) && !editing()) {
        setSel(t);
        setMenu(null);
      }
    }, 60000);
    return () => clearInterval(id);
  }, [view, sel]);

  const show = (v: View) => {
    setView(v);
    setMenuOpen(false);
  };
  const select = (k: DayKey) => {
    setSel(k);
    setMenu(null);
  };
  const openDash = () => {
    show("dash");
    setMenu(null);
    window.scrollTo(0, 0);
  };
  const openPlan = (focus?: string) => {
    setEditDay(wdIndex(sel));
    show("plan");
    window.scrollTo(0, 0);
    if (focus) focusNext(focus, true);
  };
  const closePlan = () => {
    store.closePlan();
    setMenu(null);
    show("day");
  };

  const screen = store.auth === "starting" ? "boot" : store.auth === "setup" ? "setup" : store.auth === "signedOut" ? "login" : view;
  const inApp = screen === "day" || screen === "dash";
  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>Gym Log</h1>
          <p className="sub" id="tagline" hidden={signedIn}>
            5-day split + cardio + 10,000 steps.
          </p>
          <div className="status" id="status" aria-live="polite">
            {store.status}
          </div>
        </div>
        <div className="topright">
          <button className="ghost" id="dashBtn" hidden={!inApp} onClick={() => (screen === "dash" ? show("day") : openDash())}>
            {screen === "dash" ? "Today" : "Dashboard"}
          </button>
          <button className="ghost" id="menuBtn" aria-haspopup="true" aria-expanded={menuOpen} hidden={!inApp} onClick={() => setMenuOpen(!menuOpen)}>
            Menu
          </button>
        </div>
      </header>

      <SyncBar />
      <AppMenu open={menuOpen} onEditPlan={() => openPlan()} />

      <BootView hidden={screen !== "boot"} />
      <SetupView hidden={screen !== "setup"} />
      <LoginView hidden={screen !== "login"} />

      <div id="appView" hidden={screen !== "day"}>
        {signedIn ? (
          <TodayView
            sel={sel}
            onSelect={select}
            onOpenDash={openDash}
            menu={menu}
            setMenu={setMenu}
            warmOpen={warmOpen === sel}
            onToggleWarm={() => setWarmOpen((w) => (w === sel ? null : sel))}
            kneeOpen={kneeEdit.day === sel ? kneeEdit.fields : []}
            onKneeChange={(f) => setKneeEdit((k) => ({ day: sel, fields: [...(k.day === sel ? k.fields : []), f] }))}
            onKneeScored={(f) => setKneeEdit((k) => ({ ...k, fields: k.fields.filter((x) => x !== f) }))}
            focusNext={focusNext}
          />
        ) : null}
      </div>

      <div id="dashView" className="dash" hidden={screen !== "dash"}>
        {screen === "dash" ? <DashboardView onSetGoal={() => openPlan("#pe_goalw")} /> : null}
      </div>

      <div id="planView" className="pe" hidden={screen !== "plan"}>
        {screen === "plan" ? <PlanEditor editDay={editDay} onEditDay={setEditDay} onDone={closePlan} /> : null}
      </div>
    </div>
  );
}
