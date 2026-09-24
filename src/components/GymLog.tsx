"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFocusNext } from "@/hooks/useFocusNext";
import { useGym } from "@/hooks/useGym";
import { useKeyboardUp } from "@/hooks/useKeyboardUp";
import { stopListening } from "@/hooks/useVoice";
import { addDays, parseKey, todayKey, wdIndex } from "@/lib/dates";
import { METRIC_TITLE } from "@/lib/healthView";
import { isNative } from "@/lib/native";
import { depthOf, hashOf, parentOf, routeOf, sameRoute, tabOf, type Route } from "@/lib/route";
import { applyTheme, savedTheme } from "@/lib/theme";
import type { DayKey } from "@/lib/types";
import { DashboardView } from "./dashboard/DashboardView";
import { HealthDetail } from "./health/HealthDetail";
import { HealthView } from "./health/HealthView";
import { PlanEditor } from "./plan/PlanEditor";
import { SettingsView } from "./settings/SettingsView";
import { AppBar } from "./shell/AppBar";
import { BootView } from "./shell/BootView";
import { ChoosePlanView } from "./shell/ChoosePlanView";
import { LoginView } from "./shell/LoginView";
import { SetupView } from "./shell/SetupView";
import { SyncBar } from "./shell/SyncBar";
import { TabBar } from "./shell/TabBar";
import { TodayView } from "./today/TodayView";
import type { KneeEdit, LiftMenu } from "./today/types";

const TODAY: Route = { view: "today" };
const address = (r: Route) => location.pathname + location.search + hashOf(r);
/** How many entries deep in the app's history this one is (0: Today), as the app set it. */
const stackDepth = () => (history.state as { gymDepth?: number } | null)?.gymDepth ?? 0;

/** A text box has focus, so the page shouldn't move under the person typing. */
const editing = () => {
  const a = document.activeElement;
  return !!a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && (a as HTMLInputElement).type !== "checkbox"));
};

// Home-screen shortcuts (public/manifest.webmanifest) open /?go=today, weight or steps.
const shortcut = () => (typeof location === "undefined" ? null : new URL(location.href).searchParams.get("go"));

const longDate = (k: DayKey) => parseKey(k).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

/** The app, behind sign-in: four tabs (Today, Health, Progress, Settings) along the bottom, pages under them
 *  (a Health metric, the plan editor) with a back arrow. The data lives in the store (lib/store.ts); this keeps
 *  what's on screen: the route, the selected days and what's unfolded. */
export default function GymLog() {
  const store = useGym();
  const focusNext = useFocusNext();
  const keyboardUp = useKeyboardUp();
  const [route, setRoute] = useState<Route>(() => (typeof location === "undefined" ? TODAY : routeOf(location.hash)));
  const [sel, setSel] = useState<DayKey>(todayKey);
  const [healthDay, setHealthDay] = useState<DayKey>(todayKey);
  const [menu, setMenu] = useState<LiftMenu | null>(null);
  const [warmOpen, setWarmOpen] = useState<DayKey | null>(null);
  const [kneeEdit, setKneeEdit] = useState<KneeEdit>({ day: null, fields: [] });
  const [editDay, setEditDay] = useState(() => wdIndex(todayKey()));
  const [, setToday] = useState(todayKey);
  const [go] = useState(shortcut);
  // A backup restored on the first-run screen: under way, and then what it brought in, for Settings → Your data.
  const [restoring, setRestoring] = useState(false);
  const [restored, setRestored] = useState("");
  const shown = useRef(route);
  const backing = useRef(false); // a Back this app started that hasn't landed yet
  useLayoutEffect(() => {
    shown.current = route;
  }, [route]);

  // Opened at a screen's address: put Today (and the page's tab) behind it, so Back walks out the usual way.
  useEffect(() => {
    const r = routeOf(location.hash), d = depthOf(r);
    if (!d || typeof (history.state as { gymDepth?: number } | null)?.gymDepth === "number") return;
    const chain = d === 2 ? [parentOf(r), r] : [r];
    history.replaceState({ gymDepth: 0 }, "", address(TODAY));
    chain.forEach((c, i) => history.pushState({ gymDepth: i + 1 }, "", address(c)));
  }, []);

  // Each sign-in starts on Today. (The first one keeps a screen opened by its address, e.g. #settings.)
  const uid = store.user?.id ?? null;
  const [uiFor, setUiFor] = useState<string | null>(null);
  if (uid !== uiFor) {
    setUiFor(uid);
    setRestoring(false);
    setRestored("");
    if (uiFor !== null) {
      setRoute(TODAY);
      setMenu(null);
    }
  }

  useEffect(() => store.start(), [store]);

  // Today stays mounted behind the other tabs, so a lift still listening there would log what's said on another
  // screen, or into a day no longer on show: leaving Today, or picking another day, stops it.
  useEffect(() => stopListening(), [route.view, sel]);

  // Inside the Android app: sign-in links and Health Connect (src/native/, loaded only there).
  useEffect(() => {
    if (isNative()) void import("@/native/app").then((m) => m.startNative(store));
  }, [store]);

  // A theme picked in Settings (set on the page before it's drawn): the browser's bar, and the phone's status bar.
  useEffect(() => {
    const t = savedTheme();
    applyTheme(t);
    if (isNative() && t !== "system") void import("@/native/app").then((m) => m.setBarStyle(t));
  }, []);

  // The offline copy: out/sw.js, written by scripts/build-sw.mjs after each build. The Android app has
  // its files on the phone already.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator) || isNative()) return;
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
    history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    if (go === "weight" || go === "steps") focusNext(`#${go}`, true);
  }, [signedIn, go, focusNext]);

  // Roll the date over if the app stays open past midnight.
  useEffect(() => {
    const id = setInterval(() => {
      const t = todayKey();
      setToday(t);
      if (sel !== t && sel === addDays(t, -1) && !(route.view === "today" && editing())) {
        setSel(t);
        setMenu(null);
      }
      setHealthDay((d) => (d === addDays(t, -1) ? t : d));
    }, 60000);
    return () => clearInterval(id);
  }, [route, sel]);

  // Leaving the plan editor tidies the plan and saves it straight away. Leaving Settings drops what a restore said there.
  const leave = useCallback(
    (from: Route, to: Route) => {
      if (from.view === "plan" && to.view !== "plan") {
        if (store.user) store.closePlan();
        setMenu(null);
      }
      if (from.view === "settings" && to.view !== "settings") setRestored("");
    },
    [store],
  );

  // Back and Forward, or an edited address, switch screens.
  useEffect(() => {
    const onPop = () => {
      backing.current = false;
      const to = routeOf(location.hash);
      if (sameRoute(to, shown.current)) return;
      leave(shown.current, to);
      setRoute(to);
      if (to.view !== "today") window.scrollTo(0, 0);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [leave]);

  // A screen closed some other way (signing out) takes its address with it. (A Back on its way does that itself.)
  useEffect(() => {
    if (route.view === "today" && !backing.current && routeOf(location.hash).view !== "today") history.replaceState({ gymDepth: 0 }, "", address(TODAY));
  }, [route]);

  const stepBack = (n: number) => {
    backing.current = true;
    history.go(-n);
    setTimeout(() => (backing.current = false), 1000); // in case the Back never lands
  };

  /** Moves to another screen from a tap. Tabs sit one entry after Today and pages one after where they were
   *  opened: going deeper adds an entry, going across replaces it, going to Today steps back to it. So Back
   *  retraces the way, and never returns to a screen that was closed. */
  const navigate = (to: Route) => {
    if (backing.current || sameRoute(to, route)) return false;
    const depth = stackDepth();
    if (to.view === "today") {
      if (depth > 0) stepBack(depth);
      else history.replaceState({ gymDepth: 0 }, "", address(TODAY));
    } else if (depthOf(to) > depthOf(route)) history.pushState({ gymDepth: depth + 1 }, "", address(to));
    else history.replaceState({ gymDepth: depth }, "", address(to));
    leave(route, to);
    setRoute(to);
    if (to.view !== "today") window.scrollTo(0, 0);
    return true;
  };
  /** The back arrow: back to wherever this page was opened from, or, with nothing to go back to, its tab. */
  const goBack = () => {
    if (backing.current) return;
    if (stackDepth() > 0) stepBack(1);
    else navigate(parentOf(route));
  };
  const select = (k: DayKey) => {
    setSel(k);
    setMenu(null);
  };
  const openPlan = (focus?: string) => {
    if (!navigate({ view: "plan" })) return;
    setEditDay(wdIndex(sel));
    if (focus) focusNext(focus, true);
  };

  // A new account chooses a plan before Today; until the first load says whether it's new, the loading placeholder.
  // A backup restored there keeps the picker up until it's in, then opens Settings at Your data to say what came in.
  const step = store.planStep();
  const screen =
    store.auth === "starting" || step === "wait"
      ? "boot"
      : store.auth === "setup"
        ? "setup"
        : store.auth === "signedOut"
          ? "login"
          : step === "choose" || restoring
            ? "choose"
            : "app";
  const inApp = screen === "app";
  useEffect(() => {
    if (!restored || !inApp || route.view !== "settings") return;
    document.getElementById("setData")?.scrollIntoView({ block: "start" });
    document.getElementById("dataMsg")?.focus({ preventScroll: true });
  }, [restored, inApp, route]);
  const sub = depthOf(route) === 2;
  const title =
    route.view === "today"
      ? "Today"
      : route.view === "health"
        ? route.metric
          ? METRIC_TITLE[route.metric]
          : "Health"
        : route.view === "progress"
          ? "Progress"
          : route.view === "settings"
            ? "Settings"
            : "Edit plan";
  return (
    <div className="wrap" data-tabs={inApp && !sub ? "" : undefined}>
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
      {inApp ? (
        <AppBar
          title={title}
          sub={route.view === "today" ? longDate(sel) : route.view === "progress" ? `As of ${longDate(todayKey())}` : undefined}
          backHref={sub ? hashOf(parentOf(route)) || "./" : undefined}
          onBack={sub ? goBack : undefined}
          status={store.status}
        />
      ) : (
        <header className="appbar brand">
          <div className="appbar-t">
            <h1 translate="no">Gym Log</h1>
            <p className="sub" id="tagline">
              Lifts + cardio + 10,000 steps.
            </p>
          </div>
          <div className="status" id="status" aria-live="polite">
            {store.status}
          </div>
        </header>
      )}

      <main id="main" tabIndex={-1}>
        <SyncBar />
        <BootView hidden={screen !== "boot"} />
        <SetupView hidden={screen !== "setup"} />
        <LoginView hidden={screen !== "login"} />
        <ChoosePlanView
          key={uid ?? ""}
          hidden={screen !== "choose"}
          onChosen={() => {
            navigate(TODAY);
            window.scrollTo(0, 0);
          }}
          onRestoring={setRestoring}
          onRestored={(msg) => {
            setRestored(msg);
            navigate({ view: "settings" });
          }}
        />

        <div id="appView" hidden={!inApp || route.view !== "today"}>
          {inApp ? (
            <TodayView
              sel={sel}
              onSelect={select}
              onOpenDash={() => navigate({ view: "progress" })}
              onOpenHealth={() => {
                setHealthDay(sel);
                navigate({ view: "health" });
              }}
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

        <div id="healthView" hidden={!inApp || route.view !== "health"}>
          {inApp && route.view === "health" ? (
            route.metric ? (
              <HealthDetail metric={route.metric} day={healthDay} onDay={setHealthDay} />
            ) : (
              <HealthView day={healthDay} onDay={setHealthDay} onOpen={(m) => navigate({ view: "health", metric: m })} onOpenSettings={() => navigate({ view: "settings" })} />
            )
          ) : null}
        </div>

        <div id="dashView" className="dash" hidden={!inApp || route.view !== "progress"}>
          {inApp && route.view === "progress" ? <DashboardView onSetGoal={() => openPlan("#pe_goalw")} /> : null}
        </div>

        <div id="settingsView" hidden={!inApp || route.view !== "settings"}>
          {inApp && route.view === "settings" ? <SettingsView onEditPlan={() => openPlan()} dataMsg={restored} /> : null}
        </div>

        <div id="planView" className="pe" hidden={!inApp || route.view !== "plan"}>
          {inApp && route.view === "plan" ? <PlanEditor editDay={editDay} onEditDay={setEditDay} onDone={goBack} /> : null}
        </div>
      </main>

      {/* While typing, the keyboard needs the room (in the app, the tabs would ride on top of it). */}
      {inApp && !sub ? <TabBar tab={tabOf(route)} hidden={keyboardUp} onOpen={(t) => navigate({ view: t })} /> : null}
    </div>
  );
}
