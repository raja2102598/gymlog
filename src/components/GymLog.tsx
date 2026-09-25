"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";
import { PushHead } from "@/components/ds/parts";
import { TabBar } from "@/components/ds/TabBar";
import { useBarsHeight } from "@/hooks/useBarsHeight";
import { useFocusNext } from "@/hooks/useFocusNext";
import { useGym } from "@/hooks/useGym";
import { useKeyboardUp } from "@/hooks/useKeyboardUp";
import { stopListening } from "@/hooks/useVoice";
import { addDays, todayKey, wdIndex } from "@/lib/dates";
import { mmss } from "@/lib/format";
import { METRIC_TITLE } from "@/lib/healthView";
import { GO_EVENT, isNative } from "@/lib/native";
import { depthOf, hashOf, isPushed, parentOf, routeOf, sameRoute, tabOf, type Route } from "@/lib/route";
import { onBack } from "@/lib/back";
import { sessionDone } from "@/lib/session";
import { applyTheme, savedTheme } from "@/lib/theme";
import type { DayKey } from "@/lib/types";
import { clearRun, dropStaleRun, endRun, keepRunsInMemory, runsFor, startRun } from "@/lib/workout";
import { LiftDetail } from "./dashboard/LiftDetail";
import { ProgressView } from "./dashboard/ProgressView";
import { HealthDetail } from "./health/HealthDetail";
import { HealthView } from "./health/HealthView";
import { HomeView } from "./home/HomeView";
import { PlanEditor } from "./plan/PlanEditor";
import { GymView } from "./settings/GymView";
import { SettingsView } from "./settings/SettingsView";
import { BootView } from "./shell/BootView";
import { ChoosePlanView } from "./shell/ChoosePlanView";
import { DemoBar } from "./shell/DemoBar";
import { LoginView } from "./shell/LoginView";
import { SetupView } from "./shell/SetupView";
import { SwUpdateNotice } from "./shell/SwUpdateNotice";
import { SyncBar } from "./shell/SyncBar";
import { UpdateNotice } from "./shell/UpdateNotice";
import type { LiftMenu } from "./today/types";
import { TrainView } from "./train/TrainView";
import { CompleteView } from "./workout/CompleteView";
import { WorkoutView } from "./workout/WorkoutView";

const HOME: Route = { view: "home" };
const address = (r: Route) => location.pathname + location.search + hashOf(r);
/** This app's history entries: how far past Home, and the address of the screen this one was opened from. */
type Entry = { gymDepth?: number; from?: string } | null;
/** How many entries deep in the app's history this one is (0: Home), as the app set it. */
const stackDepth = () => (history.state as Entry)?.gymDepth ?? 0;
/** A screen's name, as the back chevron's label says it: "Back to Health", "Back to the workout". */
const placeName = (r: Route): string =>
  r.metric
    ? METRIC_TITLE[r.metric]
    : r.lift
      ? r.lift
      : r.done
        ? "Workout complete"
        : { home: "Home", train: "Train", progress: "Progress", health: "Health", settings: "Settings", plan: "Edit plan", gym: "My gym", workout: "the workout" }[r.view];
/** Where the back chevron goes: the screen this one was opened from, or, with nothing behind it, its parent. */
const backTo = (r: Route): Route => {
  const from = typeof history === "undefined" ? undefined : (history.state as Entry)?.from;
  return stackDepth() > 0 && from != null ? routeOf(from) : parentOf(r);
};

/** A text box has focus, so the page shouldn't move under the person typing. */
const editing = () => {
  const a = document.activeElement;
  return !!a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && (a as HTMLInputElement).type !== "checkbox"));
};

// Home-screen shortcuts (public/manifest.webmanifest) open /?go=today, weight or steps.
const shortcut = () => (typeof location === "undefined" ? null : new URL(location.href).searchParams.get("go"));

/** The workout under way, from its address: the day it's for is Train's selected day. */
const WORKOUT_DAY_KEY = "gymlog.workoutDay.v1";

/** The app, behind sign-in: four tabs (Home, Train, Progress, Health) along the bottom, and screens pushed over them
 *  (Settings, a Health metric, a lift, the plan editor, My gym, the workout) with a back chevron. The data lives in
 *  the store (lib/store.ts); this keeps what's on screen: the route, the selected days and what's unfolded. */
export default function GymLog() {
  const store = useGym();
  const focusNext = useFocusNext();
  const keyboardUp = useKeyboardUp();
  const bars = useBarsHeight<HTMLDivElement>();
  const [route, setRoute] = useState<Route>(() => {
    if (typeof location === "undefined") return HOME;
    // A shortcut to today's weight or steps opens Train, where those fields are.
    const g = shortcut();
    return g === "weight" || g === "steps" ? { view: "train" } : routeOf(location.hash);
  });
  const [sel, setSel] = useState<DayKey>(() => {
    // Reopened on the workout (a reload, the app coming back): the day it was for.
    if (typeof location !== "undefined" && routeOf(location.hash).view === "workout") {
      try {
        const d = sessionStorage.getItem(WORKOUT_DAY_KEY);
        if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      } catch {
        /* no session storage: today */
      }
    }
    return todayKey();
  });
  const [healthDay, setHealthDay] = useState<DayKey>(todayKey);
  const [menu, setMenu] = useState<LiftMenu | null>(null);
  const [warmOpen, setWarmOpen] = useState<DayKey | null>(null);
  /** The block the workout opens on: a lift tapped in Train, or where it left off. */
  const [editDay, setEditDay] = useState(() => wdIndex(todayKey()));
  const [workoutAt, setWorkoutAt] = useState<number | null>(null);
  const [, setToday] = useState(todayKey);
  const [go] = useState(shortcut);
  // A backup restored on the first-run screen: under way, and then what it brought in, for Settings → Your data.
  const [restoring, setRestoring] = useState(false);
  const [restored, setRestored] = useState("");
  // A new service worker took over this open tab (website only; the Android app has none): only a reload runs it.
  const [swUpdated, setSwUpdated] = useState(false);
  const shown = useRef(route);
  const backing = useRef(false); // a Back this app started that hasn't landed yet
  useLayoutEffect(() => {
    shown.current = route;
  }, [route]);

  // Opened at a screen's address: put Home (and the page's tab) behind it, so Back walks out the usual way.
  useEffect(() => {
    const r = routeOf(location.hash), d = depthOf(r);
    if (!d || typeof (history.state as { gymDepth?: number } | null)?.gymDepth === "number") return;
    const up = parentOf(r), chain = d >= 2 && up.view !== "home" ? [up, r] : [r];
    history.replaceState({ gymDepth: 0 }, "", address(HOME));
    chain.forEach((c, i) => history.pushState({ gymDepth: i + 1, from: i ? hashOf(chain[i - 1]) : "" }, "", address(c)));
  }, []);

  // Each sign-in starts on Home. (The first one keeps a screen opened by its address, e.g. #settings.)
  const uid = store.user?.id ?? null;
  const [uiFor, setUiFor] = useState<string | null>(null);
  if (uid !== uiFor) {
    setUiFor(uid);
    runsFor(uid);
    setRestoring(false);
    setRestored("");
    if (uiFor !== null) {
      setRoute(HOME);
      setMenu(null);
    }
  }

  useEffect(() => store.start(), [store]);

  // A lift listening for its sets by voice stops when the screen or the day changes.
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
    let controlled = !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      if (controlled) setSwUpdated(true);
      controlled = true;
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    const register = () => void navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  // The workout's day survives a reload of its screen.
  useEffect(() => {
    if (route.view !== "workout") return;
    try {
      sessionStorage.setItem(WORKOUT_DAY_KEY, sel);
    } catch {
      /* nothing to keep it in */
    }
  }, [route.view, sel]);

  const signedIn = store.auth === "signedIn";

  // Roll the date over if the app stays open past midnight.
  useEffect(() => {
    const id = setInterval(() => {
      const t = todayKey();
      setToday(t);
      if (sel !== t && sel === addDays(t, -1) && route.view !== "workout" && !editing()) {
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
      if (from.view === "workout" && to.view !== "workout") setMenu(null);
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
      window.scrollTo(0, 0);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [leave]);

  // A screen closed some other way (signing out) takes its address with it. (A Back on its way does that itself.)
  useEffect(() => {
    if (route.view === "home" && !backing.current && routeOf(location.hash).view !== "home") history.replaceState({ gymDepth: 0 }, "", address(HOME));
  }, [route]);

  const stepBack = useCallback((n: number) => {
    backing.current = true;
    history.go(-n);
    setTimeout(() => (backing.current = false), 1000); // in case the Back never lands
  }, []);

  /** Moves to another screen from a tap. Tabs sit one entry after Home and pages one after where they were
   *  opened: going deeper adds an entry, going across replaces it, going Home steps back to it. So Back retraces
   *  the way, and never returns to a screen that was closed. */
  const navigate = useCallback(
    (to: Route) => {
      if (backing.current || sameRoute(to, route)) return false;
      const depth = stackDepth();
      if (to.view === "home") {
        if (depth > 0) stepBack(depth);
        else history.replaceState({ gymDepth: 0 }, "", address(HOME));
      } else if (depthOf(to) > depthOf(route)) history.pushState({ gymDepth: depth + 1, from: hashOf(route) }, "", address(to));
      else history.replaceState({ gymDepth: depth, from: (history.state as Entry)?.from }, "", address(to));
      leave(route, to);
      setRoute(to);
      window.scrollTo(0, 0);
      return true;
    },
    [route, leave, stepBack],
  );
  /** The back chevron: back to wherever this page was opened from, or, with nothing to go back to, its parent. */
  const goBack = () => {
    if (backing.current) return;
    if (stackDepth() > 0) stepBack(1);
    else navigate(parentOf(route));
  };
  // The phone's Back (lib/back.ts, from the Android app): an open menu closes first, then any screen but Home goes
  // back the way the chevron does. On Home there's nothing to go back to, and the app goes to the background.
  const onPhoneBack = useRef<() => boolean>(() => false);
  useLayoutEffect(() => {
    onPhoneBack.current = () => {
      if (menu) {
        setMenu(null);
        return true;
      }
      if (route.view === "home") return false;
      goBack();
      return true;
    };
  });
  useEffect(() => onBack(() => onPhoneBack.current()), []);
  const select = (k: DayKey) => {
    setSel(k);
    setMenu(null);
  };
  const openTrain = (k: DayKey) => {
    select(k);
    navigate({ view: "train" });
  };
  const openPlan = (focus?: string) => {
    if (!navigate({ view: "plan" })) return;
    setEditDay(wdIndex(sel));
    if (focus) focusNext(focus, true);
  };
  const openLift = (name: string) => navigate({ view: "progress", lift: name });
  /** Opens the workout for day `k`, at block `at` (or where it left off), and starts its clock, unless every lift is
   *  already done: reviewing a finished workout neither starts a clock nor replaces one that's running. */
  const startWorkout = (k: DayKey, at: number | null = null) => {
    keepRunsInMemory(store.demo);
    select(k);
    setWorkoutAt(at);
    // Opening a skipped day's workout (a lift row in Train) means doing it after all: the skip goes.
    if (store.entry(k).skip != null) store.unskipDay(k);
    if (!sessionDone(store, k)) startRun(k);
    else dropStaleRun(k);
    navigate({ view: "workout" });
  };
  const finishWorkout = () => {
    keepRunsInMemory(store.demo);
    endRun(sel);
    navigate({ view: "workout", done: true });
  };
  const doneWorkout = () => {
    clearRun(sel);
    navigate(HOME);
  };
  /** Weight or steps from a shortcut or the widget: today's field in Train. */
  const openField = useCallback(
    (target: string) => {
      if (target === "weight" || target === "steps") {
        setSel(todayKey());
        navigate({ view: "train" });
        focusNext(`#${target}`, true);
      } else navigate(HOME);
    },
    [navigate, focusNext],
  );

  // Reopened on a workout (a reload, or Android bringing the app back): the same clock rules as opening it from a
  // tap, once the account is known (runs belong to it): a clock left running for hours starts again, and a finished
  // day opened to review drops one.
  const restoredRun = useRef(false);
  useEffect(() => {
    if (restoredRun.current || !signedIn || !uid) return;
    restoredRun.current = true;
    const r = shown.current;
    if (r.view !== "workout" || r.done) return;
    keepRunsInMemory(store.demo);
    if (!sessionDone(store, sel)) startRun(sel);
    else dropStaleRun(sel);
  }, [signedIn, uid, store, sel]);

  // A shortcut opens today's weight or steps field, then drops ?go= from the address. Train opened that way gets
  // its own address with Home behind it, as a tap on its tab would, so a reload stays there and Back goes Home.
  useEffect(() => {
    if (!signedIn || !go || !new URL(location.href).searchParams.has("go")) return;
    const u = new URL(location.href);
    u.searchParams.delete("go");
    const base = u.pathname + u.search;
    if ((go === "weight" || go === "steps") && shown.current.view === "train" && stackDepth() === 0) {
      history.replaceState({ gymDepth: 0 }, "", base);
      history.pushState({ gymDepth: 1, from: "" }, "", base + hashOf({ view: "train" }));
    } else history.replaceState(history.state, "", base + u.hash);
    if (go === "weight" || go === "steps") focusNext(`#${go}`, true);
  }, [signedIn, go, focusNext]);

  // The home-screen widget's taps (native/app.ts) open Home, or today's weight or steps, the same way a shortcut does.
  const goTo = useRef<string | null>(null);
  const [goTick, setGoTick] = useState(0);
  useEffect(() => {
    const onGo = (ev: Event) => {
      goTo.current = (ev as CustomEvent<string>).detail;
      setGoTick((n) => n + 1);
    };
    window.addEventListener(GO_EVENT, onGo);
    return () => window.removeEventListener(GO_EVENT, onGo);
  }, []);
  useEffect(() => {
    const target = goTo.current;
    if (!signedIn || target == null) return;
    goTo.current = null;
    openField(target);
  }, [signedIn, goTick, openField]);

  // A new account chooses a plan first; until the first load says whether it's new, the loading placeholder.
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

  const pushed = isPushed(route);
  const tabs = inApp && !pushed;
  const title =
    route.view === "health" && route.metric
      ? METRIC_TITLE[route.metric]
      : route.view === "progress" && route.lift
        ? route.lift
        : route.view === "settings"
          ? "Settings"
          : route.view === "gym"
            ? "My gym"
            : route.view === "plan"
              ? "Edit plan"
              : "";
  const backLabel = pushed ? `Back to ${placeName(backTo(route))}` : "";
  const v = route.view;
  return (
    <div className="wrap" data-tabs={tabs ? "" : undefined} data-view={inApp ? v : screen}>
      <a
        className="skip"
        href="#main"
        onClick={(ev) => {
          ev.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <p className="sr-only" id="status" aria-live="polite">
        {store.status}
      </p>
      {inApp && pushed && v !== "workout" ? <PushHead title={title} backHref={hashOf(backTo(route)) || "./"} onBack={goBack} backLabel={backLabel} /> : null}

      <main id="main" tabIndex={-1}>
        <div className="bars" ref={bars}>
          <DemoBar />
          <SyncBar />
          <SwUpdateNotice show={swUpdated} onReload={() => location.reload()} />
          {isNative() && inApp ? <UpdateNotice /> : null}
        </div>
        <BootView hidden={screen !== "boot"} />
        <SetupView hidden={screen !== "setup"} />
        <LoginView hidden={screen !== "login"} />
        <ChoosePlanView
          key={uid ?? ""}
          hidden={screen !== "choose"}
          onChosen={() => {
            navigate(HOME);
            window.scrollTo(0, 0);
          }}
          onRestoring={setRestoring}
          onRestored={(msg) => {
            setRestored(msg);
            navigate({ view: "settings" });
          }}
        />

        {inApp && v === "home" ? (
          <div id="homeView" className="view">
            <HomeView
              onOpenDay={openTrain}
              onStart={(k) => startWorkout(k)}
              onOpenSettings={() => navigate({ view: "settings" })}
              onOpenHealth={() => {
                setHealthDay(todayKey());
                navigate({ view: "health" });
              }}
              focusNext={focusNext}
            />
          </div>
        ) : null}

        {inApp && v === "train" ? (
          <div id="trainView" className="view">
            <TrainView
              sel={sel}
              onSelect={select}
              onStart={(at) => startWorkout(sel, at)}
              onOpenPlan={() => openPlan()}
              onOpenGym={() => navigate({ view: "gym" })}
              onOpenSettings={() => navigate({ view: "settings" })}
              warmOpen={warmOpen === sel}
              onToggleWarm={() => setWarmOpen((w) => (w === sel ? null : sel))}
              focusNext={focusNext}
            />
          </div>
        ) : null}

        {inApp && v === "workout" ? (
          <div id="workoutView" className="view">
            {route.done ? (
              <CompleteView day={sel} onDone={doneWorkout} />
            ) : (
              <WorkoutView
                key={sel}
                day={sel}
                startAt={workoutAt}
                onStep={setWorkoutAt}
                onClose={goBack}
                onFinish={finishWorkout}
                onOpenLift={openLift}
                menu={menu}
                setMenu={setMenu}
                focusNext={focusNext}
              />
            )}
          </div>
        ) : null}

        {inApp && v === "health" ? (
          <div id="healthView" className="view">
            {route.metric ? (
              <HealthDetail metric={route.metric} day={healthDay} onDay={setHealthDay} />
            ) : (
              <HealthView
                day={healthDay}
                onDay={setHealthDay}
                onOpen={(m) => navigate({ view: "health", metric: m })}
                onOpenSettings={() => navigate({ view: "settings" })}
                onOpenTrain={() => openTrain(todayKey())}
              />
            )}
          </div>
        ) : null}

        {inApp && v === "progress" ? (
          <div id="dashView" className="view">
            {route.lift ? <LiftDetail key={route.lift} name={route.lift} /> : <ProgressView onSetGoal={() => openPlan("#pe_goalw")} onOpenLift={openLift} onOpenTrain={() => openTrain(todayKey())} onOpenSettings={() => navigate({ view: "settings" })} />}
          </div>
        ) : null}

        {inApp && v === "settings" ? (
          <div id="settingsView" className="view">
            <SettingsView onEditPlan={() => openPlan()} onOpenGym={() => navigate({ view: "gym" })} dataMsg={restored} />
          </div>
        ) : null}

        {inApp && v === "plan" ? (
          <div id="planView" className="view pe">
            <PlanEditor editDay={editDay} onEditDay={setEditDay} onDone={goBack} />
          </div>
        ) : null}

        {inApp && v === "gym" ? (
          <div id="gymView" className="view">
            <GymView onDone={goBack} />
          </div>
        ) : null}
      </main>

      {inApp && v !== "workout" ? <RestPill onOpen={() => startWorkout(store.rest?.day ?? sel)} /> : null}
      {/* While typing, the keyboard needs the room (in the app, the tabs would ride on top of it). */}
      {tabs ? <TabBar tab={tabOf(route)} hidden={keyboardUp} onOpen={(t) => navigate({ view: t })} /> : null}
    </div>
  );
}

/** A rest counting down while you're away from the workout: its time, and a way back. */
function RestPill({ onOpen }: { onOpen: () => void }) {
  const store = useGym();
  const r = store.rest;
  const running = !!r && r.pausedAt == null && !r.ended;
  const [, retick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => retick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  if (!r) return null;
  return (
    <a
      className="restpill"
      id="restPill"
      href="#workout"
      onClick={(ev) => {
        ev.preventDefault();
        onOpen();
      }}
    >
      <Timer size={18} aria-hidden="true" />
      <span aria-hidden="true">{r.ended ? "Rest over" : mmss(store.restRemaining())}</span>
      <span className="sr-only">{r.ended ? "Rest over. " : "Resting. "}Back to the workout</span>
    </a>
  );
}
