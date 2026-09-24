"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { ViewLink } from "./ui/ViewLink";

type View = "day" | "dash" | "plan";

// The dashboard and the plan editor have their own address (#dashboard, #plan), so the phone's Back
// button returns to Today, and either can be opened from a link or in a new tab.
const HASH: Record<View, string> = { day: "", dash: "#dashboard", plan: "#plan" };
const viewIn = (hash: string): View => (hash === HASH.dash ? "dash" : hash === HASH.plan ? "plan" : "day");
const address = (v: View) => location.pathname + location.search + HASH[v];

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
  const [view, setView] = useState<View>(() => (typeof location === "undefined" ? "day" : viewIn(location.hash)));
  const [sel, setSel] = useState<DayKey>(todayKey);
  const [menu, setMenu] = useState<LiftMenu | null>(null);
  const [warmOpen, setWarmOpen] = useState<DayKey | null>(null);
  const [kneeEdit, setKneeEdit] = useState<KneeEdit>({ day: null, fields: [] });
  const [editDay, setEditDay] = useState(() => wdIndex(todayKey()));
  const [menuOpen, setMenuOpen] = useState(false);
  const [, setToday] = useState(todayKey);
  const [go] = useState(shortcut);
  const shown = useRef(view);
  const backing = useRef(false); // a Back this app started that hasn't landed yet
  useLayoutEffect(() => {
    shown.current = view;
  }, [view]);

  // Each sign-in starts on Today. (The first one keeps a view opened by its address, e.g. #dashboard.)
  const uid = store.user?.id ?? null;
  const [uiFor, setUiFor] = useState<string | null>(null);
  if (uid !== uiFor) {
    setUiFor(uid);
    if (uiFor !== null) {
      setView("day");
      setMenu(null);
      setMenuOpen(false);
    }
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

  // Leaving the plan editor tidies the plan and saves it straight away.
  const leave = useCallback(
    (from: View, to: View) => {
      if (from === "plan" && to !== "plan") {
        if (store.user) store.closePlan();
        setMenu(null);
      }
      setMenuOpen(false);
    },
    [store],
  );

  // Back and Forward, or an edited address, switch views.
  useEffect(() => {
    const onPop = () => {
      backing.current = false;
      const to = viewIn(location.hash);
      if (to === shown.current) return;
      leave(shown.current, to);
      setView(to);
      if (to !== "day") window.scrollTo(0, 0);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [leave]);

  // A view closed some other way (signing out) takes its address with it. (A Back on its way does that itself.)
  useEffect(() => {
    if (view === "day" && !backing.current && viewIn(location.hash) !== "day") history.replaceState(null, "", address("day"));
  }, [view]);

  /** Switches view from a tap. The dashboard and plan get a history entry; going back to Today steps back
   *  over it, so Back never returns to a view that was closed. */
  const navigate = (to: View) => {
    if (backing.current || to === view) return false;
    if (to === "day") {
      if (history.state?.gymView) {
        backing.current = true;
        history.back();
        setTimeout(() => (backing.current = false), 1000); // in case the Back never lands
      } else history.replaceState(null, "", address("day"));
    } else if (view === "day") history.pushState({ gymView: to }, "", address(to));
    else history.replaceState({ gymView: to }, "", address(to));
    leave(view, to);
    setView(to);
    return true;
  };
  const select = (k: DayKey) => {
    setSel(k);
    setMenu(null);
  };
  const openDash = () => {
    if (!navigate("dash")) return;
    setMenu(null);
    window.scrollTo(0, 0);
  };
  const openPlan = (focus?: string) => {
    if (!navigate("plan")) return;
    setEditDay(wdIndex(sel));
    window.scrollTo(0, 0);
    if (focus) focusNext(focus, true);
  };

  const screen = store.auth === "starting" ? "boot" : store.auth === "setup" ? "setup" : store.auth === "signedOut" ? "login" : view;
  const inApp = screen === "day" || screen === "dash";
  return (
    <div className="wrap">
      <a
        className="ghost skip"
        href="#main"
        onClick={(ev) => {
          ev.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="top">
        <div>
          <h1 translate="no">Gym Log</h1>
          <p className="sub" id="tagline" hidden={signedIn}>
            5-day split + cardio + 10,000 steps.
          </p>
          <div className="status" id="status" aria-live="polite">
            {store.status}
          </div>
        </div>
        <div className="topright">
          <ViewLink
            className="ghost"
            id="dashBtn"
            hidden={!inApp}
            href={screen === "dash" ? "./" : HASH.dash}
            onOpen={() => (screen === "dash" ? navigate("day") : openDash())}
          >
            {screen === "dash" ? "Today" : "Dashboard"}
          </ViewLink>
          <button className="ghost" id="menuBtn" aria-controls="menu" aria-expanded={menuOpen} hidden={!inApp} onClick={() => setMenuOpen(!menuOpen)}>
            Menu
          </button>
        </div>
      </header>

      <AppMenu open={menuOpen} onEditPlan={() => openPlan()} />

      <main id="main" tabIndex={-1}>
        <SyncBar />
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
          {screen === "plan" ? <PlanEditor editDay={editDay} onEditDay={setEditDay} onDone={() => navigate("day")} /> : null}
        </div>
      </main>
    </div>
  );
}
