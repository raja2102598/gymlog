"use client";
import type { PermissionState } from "@capacitor/core";
import { ChevronRight, Download, ExternalLink, LogOut, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { SegmentedControl } from "@/components/ds/parts";
import { ask } from "@/components/ds/Ask";
import { firstName } from "@/components/ds/ProfileButton";
import { downloadFailed, retryWith, useAndroidUpdate, withProgress } from "@/components/shell/useAndroidUpdate";
import { Group, NumField, Text } from "@/components/settings/parts";
import { ViewLink } from "@/components/ui/ViewLink";
import { useGym } from "@/hooks/useGym";
import { useSpeechSupported, useVoicePref } from "@/hooks/useVoice";
import { backupWords, CSV_COLUMNS, toCsv } from "@/lib/backup";
import { todayKey } from "@/lib/dates";
import { fmt, plural, syncedWhen } from "@/lib/format";
import { isNative } from "@/lib/native";
import { switchVoice } from "@/lib/speech";
import type { Replacing } from "@/lib/store";
import { savedTheme, setTheme, type Theme } from "@/lib/theme";
import type { Plan } from "@/lib/types";
import { availableMessage, downloadingMessage, downloadPercent, NOTHING_PUBLISHED, updateFinding } from "@/lib/update";
import type { SyncStatus } from "@/native/sync";

// Loaded only in the Android app, so the website doesn't carry the Health Connect plugin.
const native = () => import("@/native/app");

/** Settings: Health Connect and background sync, daily goals, the plan, the theme, the account and your data.
 *  `dataMsg` is what Your data says as it opens: what a backup restored on the first-run screen brought in. In the
 *  demo, whatever needs a real account or the phone (Health Connect, background sync, password, sign out, backup
 *  import, updates) is replaced or hidden instead. */
export function SettingsView({ onEditPlan, onOpenGym, dataMsg = "" }: { onEditPlan: () => void; onOpenGym: () => void; dataMsg?: string }) {
  const store = useGym();
  const demo = store.demo, p = store.plan;
  const all = store.library(), can = all.filter((x) => store.canDo(x)).length;
  const k = (v: number) => (v >= 1000 && v % 1000 === 0 ? `${v / 1000}k` : fmt(v));
  return (
    <div className="screen settings">
      <Profile />
      <h2 className="group-h">Training</h2>
      <ul className="list">
        <li>
          <ViewLink className="row set-row" id="planBtn" href="#plan" onOpen={onEditPlan}>
            <span className="row-t">
              <span className="row-tt">Plan & schedule</span>
            </span>
            <span className="row-v">{`${p.days.filter((d) => d.exercises.length).length} training days`}</span>
            <ChevronRight className="chev" size={16} aria-hidden="true" />
          </ViewLink>
        </li>
        <li>
          <ViewLink className="row set-row" id="gymBtn" href="#gym" onOpen={onOpenGym}>
            <span className="row-t">
              <span className="row-tt" id="gymRow">
                My gym
              </span>
            </span>
            <span className="row-v">{can === all.length ? "Every lift" : `${can} of ${all.length} lifts`}</span>
            <ChevronRight className="chev" size={16} aria-hidden="true" />
          </ViewLink>
        </li>
        <Training />
        <Voice />
      </ul>
      <h2 className="group-h">Health</h2>
      <ul className="list">
        {demo ? <HealthDemo /> : isNative() ? <HealthNative /> : <HealthWeb />}
        <Goals value={`${k(p.stepGoal)} · ${p.exerciseGoalMin} min · ${fmt(p.activeGoalKcal)}`} />
      </ul>
      <h2 className="group-h">App & data</h2>
      <ul className="list">
        <Appearance />
        <Data first={dataMsg} demo={demo} />
        {demo ? <AccountDemo /> : <Account />}
        <About demo={demo} />
      </ul>
      {demo ? null : (
        <button type="button" className="btn btn-raised btn-danger btn-block signout" id="signOutBtn" onClick={() => void store.signOut()}>
          <LogOut size={18} aria-hidden="true" />
          Sign out
        </button>
      )}
    </div>
  );
}

/** Who's signed in, and how: the avatar, the name (or email), and whether it's synced. */
function Profile() {
  const store = useGym();
  const name = firstName(store.user?.user_metadata), full = (store.user?.user_metadata?.full_name as string | undefined) || name;
  const google = ((store.user?.app_metadata?.providers as string[] | undefined) ?? []).includes("google");
  const how = store.demo ? "Sample data · nothing is saved" : `Signed in with ${google ? "Google" : "email"}${store.status ? ` · ${store.status.toLowerCase().replace(/\.$/, "")}` : ""}`;
  return (
    <section className="card profile" aria-label="Account">
      <span className="avatar lg" aria-hidden="true">
        {(name || store.user?.email || "?").slice(0, 1).toUpperCase()}
      </span>
      <span className="row-t">
        <span className="profile-n">{store.demo ? "Sample data" : full || store.user?.email || "You"}</span>
        <span className="row-d">{how}</span>
      </span>
    </section>
  );
}

/* ---------- Health Connect ---------- */

/** The demo, in place of HealthNative or HealthWeb: Health Connect needs a real account and, for background sync,
 *  the phone itself, so neither is offered here. */
function HealthDemo() {
  return (
    <Group title="Health Connect" id="setHealth" value="Not in the demo">
      <div className="pref-row">
        <Text title="Health Connect" sub="Not available in the demo. Sign in with a real account to connect it." />
      </div>
    </Group>
  );
}

function HealthWeb() {
  const at = useGym().healthSyncedAt;
  return (
    <Group title="Health Connect" id="setHealth" value={at ? "Synced" : "Android app"} valueOk={!!at}>
      <div className="pref-row">
        <Text
          title="From the Android app"
          sub={
            <span id="hcStatus">
              {at
                ? `Health Connect data comes from the Gym Log Android app, last synced ${syncedWhen(at)}.`
                : "Health Connect data comes from the Gym Log Android app. Connect it there, and it shows here too."}
            </span>
          }
        />
      </div>
    </Group>
  );
}

const list = (words: string[]) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);

function HealthNative() {
  const store = useGym();
  const link = store.healthLink, at = store.healthSyncedAt;
  const [access, setAccess] = useState<{ granted: string[]; missing: string[] } | null>(null);
  const [bg, setBg] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [bgMsg, setBgMsg] = useState("");

  // What Health Connect allows, and background sync: checked on opening, after each sync, and on coming back
  // to the app (from Health Connect's own screens, say).
  useEffect(() => {
    let live = true;
    const check = () =>
      void native().then(async (m) => {
        const [a, b] = await Promise.all([m.healthAccess(), m.backgroundStatus().catch(() => null)]);
        if (!live) return;
        setAccess(a);
        setBg(b);
      });
    const back = () => {
      if (!document.hidden) check();
    };
    check();
    document.addEventListener("visibilitychange", back);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", back);
    };
  }, [link.state]);

  const connect = () => void native().then((m) => m.connectHealth(store));
  const sync = () => void native().then((m) => m.syncHealth(store, true));
  const toggle = async () => {
    setBusy(true);
    const m = await native();
    try {
      setBgMsg(bg?.on ? await m.turnOffBackground(store) : await m.turnOnBackground(store));
    } catch (e) {
      setBgMsg(`Couldn’t change background sync: ${(e instanceof Error ? e.message : String(e)).replace(/\.$/, "")}.`);
    }
    setBg(await m.backgroundStatus().catch(() => null));
    setBusy(false);
  };

  const status = link.state === "web" ? "Checking Health Connect…" : link.state === "ok" && at ? `Synced ${syncedWhen(at)}. ${link.msg}` : link.msg;
  const connected = link.state !== "off" && link.state !== "unavailable" && link.state !== "web";
  const last = bg?.lastRunAt ? `Last ran ${syncedWhen(new Date(bg.lastRunAt).toISOString())}: ${bg.lastMsg.replace(/\.$/, "")}.` : "It runs for the first time shortly.";
  const bgText = !bg
    ? "Checking…"
    : bgMsg ||
      (!bg.available
        ? "This phone’s Health Connect can’t share data in the background yet, so Gym Log syncs when you open it."
        : bg.on
          ? `On: about every hour, even when Gym Log is closed. ${last}`
          : "About every hour, even when Gym Log is closed.");
  return (
    <Group title="Health Connect" id="setHealth" value={link.state === "off" ? "Not connected" : link.state === "unavailable" ? "Unavailable" : connected ? "Connected" : ""} valueOk={connected}>
      <div className="pref-row">
        <Text title="Health Connect" sub={<span id="hcStatus" role="status">{status}</span>} />
        {link.state === "off" ? (
          <button className="btn btn-sm" id="hcConnect" onClick={connect}>
            Connect
          </button>
        ) : connected ? (
          <button className="btn btn-sm" id="hcSync" onClick={sync} disabled={link.state === "syncing"}>
            Sync now
          </button>
        ) : null}
      </div>
      {connected && access?.missing.length ? (
        <div className="pref-row">
          <Text
            title={`Allow ${plural(access.missing.length, "more kind")} of data`}
            sub={`Gym Log can also read ${list(access.missing)}, if your phone or watch records them.`}
          />
          <button className="btn btn-sm" id="hcMore" onClick={connect}>
            Allow
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="pref-row pref-tap"
        role="switch"
        id="bgSync"
        aria-checked={!!bg?.on}
        aria-labelledby="bgT"
        aria-describedby="bgD"
        disabled={!bg || busy || !connected || (!bg.available && !bg.on)}
        onClick={() => void toggle()}
      >
        <Text id="bg" title="Sync in the background" sub={bgText} />
        <span className="switch" aria-hidden="true" />
      </button>
      {connected ? (
        <button type="button" className="pref-row pref-tap" id="hcManage" onClick={() => void native().then((m) => m.openHealthSettings())}>
          <Text title="Manage in Health Connect" sub={access ? `Gym Log reads ${plural(access.granted.length, "kind")} of data. Choose which there.` : "Choose what Gym Log can read."} />
          <ExternalLink className="pref-go" size={18} aria-hidden="true" />
        </button>
      ) : null}
    </Group>
  );
}

/* ---------- goals ---------- */

type GoalKey = "stepGoal" | "sleepGoalH" | "exerciseGoalMin" | "activeGoalKcal" | "waterGoalMl" | "restSec";
/** Plan fields saved to the nearest half, not the nearest whole number. */
const HALVES: GoalKey[] = ["sleepGoalH"];

/** A number saved straight to the plan: the daily goals, and the rest timer under Training. */
function Goal({ id, label, k, min, max, step, decimal = false }: { id: string; label: string; k: GoalKey; min: number; max: number; step: number; decimal?: boolean }) {
  const store = useGym();
  return (
    <NumField
      id={id}
      label={label}
      value={store.plan[k]}
      min={min}
      max={max}
      step={step}
      decimal={decimal}
      onSave={(v) =>
        store.editPlan((p: Plan) => {
          p[k] = HALVES.includes(k) ? Math.round(v * 2) / 2 : Math.round(v);
        })
      }
    />
  );
}

function Goals({ value }: { value: string }) {
  const store = useGym();
  return (
    <Group title="Daily goals" id="setGoals" value={value}>
      <div className="pref-row pref-col">
        <div className="pref-goals">
          <Goal id="goalSteps" label="Steps" k="stepGoal" min={500} max={100000} step={500} />
          <Goal id="goalSleep" label="Sleep (hours)" k="sleepGoalH" min={3} max={12} step={0.5} decimal />
          <Goal id="goalExercise" label="Exercise (minutes)" k="exerciseGoalMin" min={5} max={300} step={5} />
          <Goal id="goalActive" label="Active calories (kcal)" k="activeGoalKcal" min={50} max={3000} step={50} />
          <Goal id="goalWater" label="Water (ml)" k="waterGoalMl" min={250} max={8000} step={250} />
        </div>
        <p className="note" id="goalMsg" aria-live="polite">
          The rings and charts in Health measure against these. {store.planMsg}
        </p>
      </div>
    </Group>
  );
}

/* ---------- training ---------- */

/** The rest timer's length and effort per set, synced with the plan like the rest of training. */
function Training() {
  const store = useGym();
  return (
    <Group title="Rest timer & effort" id="setTraining" value={`${store.plan.restSec} s`}>
      <div className="pref-row pref-col">
        <div className="pref-goals">
          <Goal id="restSec" label="Rest after a set (seconds)" k="restSec" min={5} max={600} step={5} />
        </div>
        <p className="note" id="restMsg" aria-live="polite">
          The rest timer, started when a set’s reps are logged. A lift can override it on its own row in the plan
          editor. {store.planMsg}
        </p>
      </div>
      <div className="pref-row pref-col">
        <Text
          title="Effort per set"
          sub={
            store.plan.effort === "rpe"
              ? "RPE, 1 to 10, in each set’s menu: tap the set’s number."
              : store.plan.effort === "rir"
                ? "Reps in reserve, 0 to 10, in each set’s menu: tap the set’s number."
                : "Not logged. Pick RPE or reps in reserve to add it to each set’s menu."
          }
        />
        <SegmentedControl
          value={store.plan.effort}
          label="Effort per set"
          onChange={(v) =>
            store.editPlan((p: Plan) => {
              p.effort = v;
            })
          }
          options={[
            ["off", "Off"],
            ["rpe", "RPE"],
            ["rir", "RIR"],
          ]}
        />
      </div>
      {isNative() ? <RestNotifications /> : null}
    </Group>
  );
}

/* ---------- rest timer notifications ---------- */

/** Android 13 and later ask permission to post notifications; older versions grant it automatically (checked the
 *  same way either way, RestTimerPlugin.kt). Lets the rest timer notify at zero while Gym Log is backgrounded or
 *  closed (docs/android.md). The button only shows while asking would actually do something: once Android has
 *  turned it down for good, only its own settings screen can turn it back on. */
function RestNotifications() {
  const [state, setState] = useState<PermissionState | null>(null);
  useEffect(() => {
    let live = true;
    void native().then((m) =>
      m.notificationPermission().then((s) => {
        if (live) setState(s);
      }),
    );
    return () => {
      live = false;
    };
  }, []);
  const ask = () =>
    void native()
      .then((m) => m.requestNotificationPermission())
      .then(setState);
  if (!state) return null;
  const canAsk = state === "prompt" || state === "prompt-with-rationale";
  return (
    <div className="pref-row">
      <Text
        title="Rest timer notifications"
        sub={
          <span id="restNotifStatus" role="status">
            {state === "granted"
              ? "On. While Gym Log is out of sight, your workout’s clock and rest countdown stay on the lock screen, and it tells you when a rest ends."
              : canAsk
                ? "Off. Gym Log can show your workout’s clock and rest countdown on the lock screen while it’s out of sight, and tell you when a rest ends."
                : "Off, and Android is blocking it. Allow notifications for Gym Log in Android’s settings to get one when a rest timer ends in the background."}
          </span>
        }
      />
      {canAsk ? (
        <button className="btn btn-sm" id="restNotifAsk" onClick={ask}>
          Allow
        </button>
      ) : null}
    </div>
  );
}

/* ---------- voice ---------- */

/** Log sets by voice: off until switched on, kept on this device like the theme, and only where the browser (or in the
 *  Android app, the phone) can listen. In the app, switching it on asks for the microphone first. */
function Voice() {
  const on = useVoicePref(), can = useSpeechSupported();
  const [refused, setRefused] = useState(false);
  if (!can) return null;
  const sub = refused
    ? "Gym Log needs the microphone to log by voice. Allow it in Android’s settings for Gym Log."
    : isNative()
      ? "Uses Android’s speech recognition, on the phone where it can. Gym Log keeps only the numbers."
      : "Uses your browser’s speech recognition. In Chrome, what you say is sent to Google to be turned into text; Gym Log keeps only the numbers.";
  return (
    <Group title="Voice" id="setVoice" value={on ? "On" : "Off"}>
      <button
        type="button"
        className="pref-row pref-tap"
        role="switch"
        id="voiceLog"
        aria-checked={on}
        aria-labelledby="voiceT"
        aria-describedby="voiceD"
        onClick={() => void switchVoice(!on).then((done) => setRefused(!done))}
      >
        <Text id="voice" title="Log sets by voice" sub={sub} />
        <span className="switch" aria-hidden="true" />
      </button>
    </Group>
  );
}

/* ---------- appearance ---------- */

function Appearance() {
  const [theme, pick] = useState<Theme>(savedTheme);
  const choose = (t: Theme) => {
    pick(t);
    setTheme(t);
    if (isNative()) void native().then((m) => m.setBarStyle(t));
  };
  return (
    <Group title="Appearance" id="setLook" value={theme === "system" ? "System" : theme === "dark" ? "Dark" : "Light"}>
      <div className="pref-row pref-col">
        <Text title="Theme" sub={theme === "system" ? "Follows the phone’s light or dark setting." : theme === "dark" ? "Always dark." : "Always light."} />
        <SegmentedControl
          value={theme}
          label="Theme"
          onChange={choose}
          options={[
            ["system", "System"],
            ["light", "Light"],
            ["dark", "Dark"],
          ]}
        />
      </div>
    </Group>
  );
}

/* ---------- account ---------- */

/** The demo, in place of Account: no password to set and nothing to sign out of, only a way to leave for the real
 *  sign-in screen (the same one the sync bar's banner offers). */
function AccountDemo() {
  const store = useGym();
  return (
    <Group title="Account" id="setAccount" value="Sample data">
      <div className="pref-row">
        <Text title="Trying the sample data" sub="Nothing you do here is saved. Sign in to keep it in your own account." />
        <button type="button" className="btn btn-sm" id="demoAccountSignIn" onClick={() => store.exitDemo()}>
          Sign in
        </button>
      </div>
    </Group>
  );
}

function Account() {
  const store = useGym();
  // The ways this account signs in, as Supabase records them: "email" (a link or password), "google".
  const google = ((store.user?.app_metadata?.providers as string[] | undefined) ?? []).includes("google");
  return (
    <Group title="Account" id="setAccount" value={google ? "Google" : "Email"}>
      <div className="pref-row">
        <Text
          title="Signed in as"
          sub={
            <>
              <span id="whoami">{store.user?.email || "you"}</span>
              {google ? " · Google account linked" : ""}
            </>
          }
        />
      </div>
      <Password />
    </Group>
  );
}

/** A password, for signing in without waiting for an email (Supabase sends only a few an hour). */
function Password() {
  const store = useGym();
  const has = store.hasPassword;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const save = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setBusy(true);
    const r = await store.setPassword(input.current!.value);
    setBusy(false);
    setMsg(r.msg);
    if (r.ok) setOpen(false);
  };
  return (
    <div className="pref-row pref-col">
      <div className="pref-line">
        <Text id="pw" title="Password" sub={has ? "Set. Sign in with it, or with an email link." : "Not set. With one, you can sign in without waiting for an email."} />
        {open ? null : (
          <button
            className="btn btn-sm"
            id="pwBtn"
            onClick={() => {
              setOpen(true);
              setMsg("");
            }}
          >
            {has ? "Change password" : "Set a password"}
          </button>
        )}
      </div>
      {open ? (
        <form id="pwForm" className="pw-form" onSubmit={save}>
          {/* Lets a password manager save the password under the right account. */}
          <input type="email" name="username" autoComplete="username" value={store.user?.email ?? ""} readOnly hidden />
          <label className="field" htmlFor="newPassword">
            <span>New password, 8 or more characters</span>
            <input ref={input} id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={8} required />
          </label>
          <div className="pref-btns">
            <button className="btn btn-primary" type="submit" id="pwSave" disabled={busy}>
              {busy ? "Saving…" : "Save password"}
            </button>
            <button className="btn btn-sm" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {msg ? (
        <p className="sub" id="pwMsg" role="status">
          {msg}
        </p>
      ) : null}
    </div>
  );
}

/* ---------- data ---------- */

/** Hands `text` to the browser as a file to download. */
function download(name: string, type: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function Data({ first, demo }: { first: string; demo: boolean }) {
  const store = useGym();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState(first);
  const exportData = () => {
    const b = store.exportBackup();
    download(`gym-log-${todayKey()}.json`, "application/json", JSON.stringify(b, null, 1));
    setMsg(`Exported ${backupWords(b.logs.length, !!b.plan, Object.keys(b.healthDays).length)}.`);
  };
  const exportCsv = () => {
    const rows = store.workoutRows();
    download(`gym-log-workouts-${todayKey()}.csv`, "text/csv", toCsv([CSV_COLUMNS, ...rows]));
    setMsg(`Exported ${plural(rows.length, "set")} as CSV.`);
  };
  // Days already logged, and the plan, are only replaced once you say so.
  const replace = ({ days, plan }: Replacing) => {
    const what = [days ? `different entries for ${plural(days, "day")} you’ve already logged` : "", plan ? "a different plan" : ""].filter(Boolean).join(", and ");
    return ask(`Replace ${days ? "them" : "yours"} with the file’s version?`, "Replace", { body: `The file has ${what}.`, danger: true });
  };
  // Only the latest import's result shows: an earlier one still saving mustn't overwrite it.
  const imports = useRef(0);
  const importData = async (ev: ChangeEvent<HTMLInputElement>) => {
    const f = ev.currentTarget.files?.[0];
    ev.currentTarget.value = "";
    if (!f) return;
    const n = ++imports.current;
    const m = await store.importFile(f, replace);
    if (n === imports.current) setMsg(m);
  };
  return (
    <Group title="Export & backup" id="setData" open={!!first}>
      <button type="button" className="pref-row pref-tap" id="exportBtn" onClick={exportData}>
        <Text title="Export data (.json)" sub="Every day you’ve logged, your plan and Health Connect data, as one file" />
        <Download className="pref-go" size={18} aria-hidden="true" />
      </button>
      {demo ? null : (
        <button type="button" className="pref-row pref-tap" id="importBtn" onClick={() => file.current?.click()}>
          <Text title="Import data (.json)" sub="Reads an export back in. You’re asked before a logged day or your plan is replaced." />
          <Upload className="pref-go" size={18} aria-hidden="true" />
        </button>
      )}
      <button type="button" className="pref-row pref-tap" id="csvBtn" onClick={exportCsv}>
        <Text title="Export workouts as CSV" sub="Every set you’ve logged, a row each, for a spreadsheet" />
        <Download className="pref-go" size={18} aria-hidden="true" />
      </button>
      {demo ? null : <input type="file" id="importFile" accept="application/json,.json" hidden ref={file} onChange={importData} />}
      {/* Focusable, so the app can put you here after a restore on the first-run screen, reading what came in. */}
      <p className="note pref-msg" id="dataMsg" role="status" tabIndex={-1}>
        {msg}
      </p>
    </Group>
  );
}

/* ---------- about ---------- */

function About({ demo }: { demo: boolean }) {
  const [build, setBuild] = useState("");
  useEffect(() => {
    if (isNative() && !demo) void native().then((m) => m.appVersion().then(setBuild, () => {}));
  }, [demo]);
  return (
    <Group title="About" id="setAbout" value={isNative() ? "Android app" : "Website"}>
      <div className="pref-row">
        <Text title={<span translate="no">Gym Log</span>} sub={isNative() ? `Android app${build ? `, version ${build}` : ""}` : "Website. The Android app adds Health Connect."} />
      </div>
      {/* Updates aren't offered in the demo: nothing here is a real, installed copy to update. */}
      {demo ? null : isNative() ? <UpdateAndroid /> : <UpdateWeb />}
    </Group>
  );
}

/** Couldn't reach GitHub to check, or the version.json it answered with doesn't parse: same words either way, since
 *  there's nothing more useful to say. */
const CANT_CHECK = "Couldn’t check for updates. Try again when you’re online.";

/** Settings → About → Check for updates, in the Android app: downloads and installs a newer build from this
 *  build's GitHub releases (see AppUpdatePlugin.kt and docs/android.md). The website's is UpdateWeb, below. */
function UpdateAndroid() {
  const { s, setS, download, install, openInstallSettings } = useAndroidUpdate({ kind: "checking" });

  // The state starts at "checking" already, so the mount effect can kick this off without setting it again itself.
  const runCheck = useCallback(() => {
    void native()
      .then(async (m) => {
        const found = updateFinding(await m.checkUpdate());
        if (found.kind === "hidden") return setS({ kind: "hidden" });
        if (found.kind === "nothingPublished") return setS({ kind: "error", message: NOTHING_PUBLISHED });
        if (found.kind === "upToDate") return setS({ kind: "upToDate" });
        const latest = found.latest;
        // Opened again while a download from an earlier visit is still going: this follows that one, rather than
        // offering a second. It ends at Install, as the screen that started it has already asked for the installer.
        if (!m.downloadUnderway()) return setS({ kind: "available", latest });
        setS({ kind: "downloading", latest, received: 0, total: latest.size });
        await m.followDownload((p) => setS(withProgress(p)))?.then(
          () => setS({ kind: "readyToInstall", latest }),
          (e: unknown) => setS(downloadFailed(e, latest)),
        );
      })
      .catch(() => setS({ kind: "error", message: CANT_CHECK }));
  }, [setS]);
  // Checked once as the screen opens, like Health Connect's own status above.
  useEffect(runCheck, [runCheck]);
  // "Check again" / "Retry": back to checking, then the same call.
  const check = () => {
    setS({ kind: "checking" });
    runCheck();
  };

  if (s.kind === "hidden") return null;
  const pct = s.kind === "downloading" ? downloadPercent(s.received, s.total) : 0;
  return (
    <>
      <div className="pref-row">
        <Text
          id="updChk"
          title="Check for updates"
          sub={
            s.kind === "checking"
              ? "Checking…"
              : s.kind === "upToDate"
                ? "You have the newest version."
                : s.kind === "available"
                  ? availableMessage(s.latest.name, s.latest.size)
                  : s.kind === "downloading"
                    ? downloadingMessage(s.received, s.total)
                    : s.kind === "readyToInstall"
                      ? `Version ${s.latest.name} is ready to install.`
                      : s.kind === "needsPermission"
                        ? "Android asks once whether Gym Log can install updates."
                        : s.message
          }
        />
        {s.kind === "error" && retryWith(s) === "install" && s.latest ? (
          // Only the installer failed: the download is on the phone, so this opens the installer again.
          <button className="btn btn-sm" id="updRetryInstall" onClick={() => install(s.latest!)}>
            Try again
          </button>
        ) : s.kind === "upToDate" || s.kind === "error" ? (
          <button className="btn btn-sm" id="updCheckBtn" onClick={check}>
            {s.kind === "error" ? "Retry" : "Check again"}
          </button>
        ) : null}
        {s.kind === "available" ? (
          <button className="btn btn-sm" id="updDownload" onClick={() => download(s.latest)}>
            Download and install
          </button>
        ) : null}
        {s.kind === "readyToInstall" ? (
          <button className="btn btn-sm" id="updInstall" onClick={() => install(s.latest)}>
            Install
          </button>
        ) : null}
        {s.kind === "needsPermission" ? (
          <button className="btn btn-sm" id="updOpenSettings" onClick={openInstallSettings}>
            Open settings
          </button>
        ) : null}
      </div>
      {s.kind === "downloading" ? (
        <div className="pref-row">
          <span className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Downloading the update" style={{ ["--c" as string]: "var(--ink)" }}>
            <i style={{ width: `${pct}%` }} />
          </span>
        </div>
      ) : null}
    </>
  );
}

type WebUpdate = "idle" | "checking" | "upToDate" | "found" | "error";

/** Settings → About → Check for updates, on the website: the service worker already updates itself in the
 *  background (GymLog's controllerchange notice says when a fetched one has taken over); this just asks it to
 *  look now instead of waiting for the browser's own schedule. */
function UpdateWeb() {
  const [s, setS] = useState<WebUpdate>("idle");
  if (typeof navigator === "undefined" || process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return null;
  const check = async () => {
    setS("checking");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
      setS(reg?.installing || reg?.waiting ? "found" : "upToDate");
    } catch {
      setS("error");
    }
  };
  return (
    <div className="pref-row">
      <Text
        id="updChkWeb"
        title="Check for updates"
        sub={
          s === "checking"
            ? "Checking…"
            : s === "upToDate"
              ? "You have the newest version."
              : s === "found"
                ? "A new version is downloading in the background."
                : s === "error"
                  ? "Couldn’t check for updates. Try again when you’re online."
                  : ""
        }
      />
      {s !== "checking" ? (
        <button className="btn btn-sm" id="updCheckWebBtn" onClick={() => void check()}>
          {s === "idle" ? "Check for updates" : "Check again"}
        </button>
      ) : null}
    </div>
  );
}
