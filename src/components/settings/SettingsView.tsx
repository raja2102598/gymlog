"use client";
import { ArrowSquareOut, CaretRight, DownloadSimple, SignOut, UploadSimple } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { Segmented } from "@/components/health/parts";
import { SyncedInput } from "@/components/ui/SyncedField";
import { ViewLink } from "@/components/ui/ViewLink";
import { useGym } from "@/hooks/useGym";
import { todayKey } from "@/lib/dates";
import { plural, syncedWhen } from "@/lib/format";
import { isNative } from "@/lib/native";
import { savedTheme, setTheme, type Theme } from "@/lib/theme";
import type { Plan } from "@/lib/types";
import type { SyncStatus } from "@/native/sync";

// Loaded only in the Android app, so the website doesn't carry the Health Connect plugin.
const native = () => import("@/native/app");

/** Settings: Health Connect and background sync, daily goals, the plan, the theme, the account and your data. */
export function SettingsView({ onEditPlan }: { onEditPlan: () => void }) {
  return (
    <>
      {isNative() ? <HealthNative /> : <HealthWeb />}
      <Goals />
      <Group title="Training" id="setTraining">
        <ViewLink className="pref-row pref-tap" id="planBtn" href="#plan" onOpen={onEditPlan}>
          <Text title="Edit plan" sub="Each day’s workout and lifts, warm-ups, tempo, goal weight and knee limit" />
          <CaretRight className="pref-go" size={18} aria-hidden="true" />
        </ViewLink>
      </Group>
      <Appearance />
      <Account />
      <Data />
      <About />
    </>
  );
}

/** A titled card of rows, as in a phone's settings. */
function Group({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section className="pref" id={id} aria-labelledby={`${id}H`}>
      <h2 className="pref-h" id={`${id}H`}>
        {title}
      </h2>
      <div className="panel pref-card">{children}</div>
    </section>
  );
}

/** A row's words: its title and, under it, what it does or how it stands. */
function Text({ title, sub, id }: { title: ReactNode; sub?: ReactNode; id?: string }) {
  return (
    <span className="pref-t">
      <span className="pref-tt" id={id ? `${id}T` : undefined}>
        {title}
      </span>
      {sub ? (
        <span className="sub" id={id ? `${id}D` : undefined}>
          {sub}
        </span>
      ) : null}
    </span>
  );
}

/* ---------- Health Connect ---------- */

function HealthWeb() {
  const at = useGym().healthSyncedAt;
  return (
    <Group title="Health Connect" id="setHealth">
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
    <Group title="Health Connect" id="setHealth">
      <div className="pref-row">
        <Text title="Health Connect" sub={<span id="hcStatus" role="status">{status}</span>} />
        {link.state === "off" ? (
          <button className="ghost" id="hcConnect" onClick={connect}>
            Connect
          </button>
        ) : connected ? (
          <button className="ghost" id="hcSync" onClick={sync} disabled={link.state === "syncing"}>
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
          <button className="ghost" id="hcMore" onClick={connect}>
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
          <ArrowSquareOut className="pref-go" size={18} aria-hidden="true" />
        </button>
      ) : null}
    </Group>
  );
}

/* ---------- goals ---------- */

type GoalKey = "stepGoal" | "sleepGoalH" | "exerciseGoalMin" | "activeGoalKcal" | "waterGoalMl";

/** A daily goal: saved as you type once it's in range (the same ranges the plan is read with, lib/plan.ts). */
function Goal({ id, label, k, min, max, step, decimal = false }: { id: string; label: string; k: GoalKey; min: number; max: number; step: number; decimal?: boolean }) {
  const store = useGym();
  const [bad, setBad] = useState(false);
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <SyncedInput
        id={id}
        type="number"
        inputMode={decimal ? "decimal" : "numeric"}
        min={min}
        max={max}
        step={step}
        value={store.plan[k]}
        aria-invalid={bad || undefined}
        aria-describedby={bad ? `${id}Err` : undefined}
        onChange={(ev) => {
          const v = +ev.target.value, ok = ev.target.value !== "" && v >= min && v <= max;
          setBad(!ok);
          if (ok)
            store.editPlan((p: Plan) => {
              p[k] = k === "sleepGoalH" ? Math.round(v * 2) / 2 : Math.round(v);
            });
        }}
      />
      {bad ? (
        <span className="err" id={`${id}Err`}>
          From {min.toLocaleString("en-IN")} to {max.toLocaleString("en-IN")}
        </span>
      ) : null}
    </label>
  );
}

function Goals() {
  const store = useGym();
  return (
    <Group title="Daily goals" id="setGoals">
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

/* ---------- appearance ---------- */

function Appearance() {
  const [theme, pick] = useState<Theme>(savedTheme);
  const choose = (t: Theme) => {
    pick(t);
    setTheme(t);
    if (isNative()) void native().then((m) => m.setBarStyle(t));
  };
  return (
    <Group title="Appearance" id="setLook">
      <div className="pref-row pref-col">
        <Text title="Theme" sub={theme === "system" ? "Follows the phone’s light or dark setting." : theme === "dark" ? "Always dark." : "Always light."} />
        <Segmented
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

function Account() {
  const store = useGym();
  return (
    <Group title="Account" id="setAccount">
      <div className="pref-row">
        <Text title="Signed in as" sub={<span id="whoami">{store.user?.email || "you"}</span>} />
      </div>
      <Password />
      <button type="button" className="pref-row pref-tap danger" id="signOutBtn" onClick={() => void store.signOut()}>
        <span className="pref-t">
          <span className="pref-tt">Sign out</span>
        </span>
        <SignOut className="pref-go" size={18} aria-hidden="true" />
      </button>
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
            className="ghost"
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
            <button className="primary" type="submit" id="pwSave" disabled={busy}>
              {busy ? "Saving…" : "Save password"}
            </button>
            <button className="ghost" type="button" onClick={() => setOpen(false)}>
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

function Data() {
  const store = useGym();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  const exportData = () => {
    const rows = store.exportRows();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 1)], { type: "application/json" }));
    a.download = `gym-log-${todayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setMsg(`Exported ${plural(rows.length, "day")}.`);
  };
  const importData = async (ev: ChangeEvent<HTMLInputElement>) => {
    const f = ev.currentTarget.files?.[0];
    ev.currentTarget.value = "";
    // Days already logged are only replaced once you say so.
    if (f) setMsg(await store.importFile(f, (n) => confirm(`The file has different entries for ${plural(n, "day")} you’ve already logged. Replace them with the file’s version?`)));
  };
  return (
    <Group title="Your data" id="setData">
      <button type="button" className="pref-row pref-tap" id="exportBtn" onClick={exportData}>
        <Text title="Export data (.json)" sub="Every day you’ve logged, as one file" />
        <DownloadSimple className="pref-go" size={18} aria-hidden="true" />
      </button>
      <button type="button" className="pref-row pref-tap" id="importBtn" onClick={() => file.current?.click()}>
        <Text title="Import data (.json)" sub="Reads an export back in. You’re asked before a logged day is replaced." />
        <UploadSimple className="pref-go" size={18} aria-hidden="true" />
      </button>
      <input type="file" id="importFile" accept="application/json,.json" hidden ref={file} onChange={importData} />
      <p className="note pref-msg" id="dataMsg" role="status">
        {msg}
      </p>
    </Group>
  );
}

/* ---------- about ---------- */

function About() {
  const [build, setBuild] = useState("");
  useEffect(() => {
    if (isNative()) void native().then((m) => m.appVersion().then(setBuild, () => {}));
  }, []);
  return (
    <Group title="About" id="setAbout">
      <div className="pref-row">
        <Text title={<span translate="no">Gym Log</span>} sub={isNative() ? `Android app${build ? `, version ${build}` : ""}` : "Website. The Android app adds Health Connect."} />
      </div>
    </Group>
  );
}
