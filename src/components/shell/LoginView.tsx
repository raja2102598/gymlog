"use client";
import { Mail } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { useGym } from "@/hooks/useGym";
import { isNative } from "@/lib/native";

// Seconds before another link can be sent: Supabase refuses sooner, and a new link replaces the last one.
const WAIT = 60;

/** Google's "G", drawn in the button's ink (the outline button in the design system carries no brand colours). */
function GoogleG() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
      <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
    </svg>
  );
}

/** Sign in (Sign in board): the mark and name, then a sheet with Continue with Google (once it's set up), Continue with
 *  email (an emailed link, or a password set in Settings), and the sample data. */
export function LoginView({ hidden }: { hidden: boolean }) {
  const store = useGym();
  const [mode, setMode] = useState<"link" | "password">("link");
  const [emailOpen, setEmailOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (!wait) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = ev.currentTarget.elements;
    const email = (f.namedItem("email") as HTMLInputElement).value.trim();
    setBusy(true);
    if (mode === "password") {
      setMsg("Signing in…");
      setMsg(await store.signInWithPassword(email, (f.namedItem("password") as HTMLInputElement).value));
    } else {
      setMsg("Sending…");
      const r = await store.sendLink(email);
      setMsg(r.msg);
      if (r.sent) setWait(WAIT);
    }
    setBusy(false);
  };
  const switchMode = () => {
    setMode(mode === "link" ? "password" : "link");
    setMsg("");
  };
  // In the app, the phone's account sheet (src/native/google.ts); on the web, off to Google's page and back.
  const google = async () => {
    setBusy(true);
    if (isNative()) {
      setMsg("Signing in with Google…");
      setMsg(await import("@/native/app").then((m) => m.signInWithGoogle(store)));
      setBusy(false);
      return;
    }
    setMsg("Opening Google…");
    const trouble = await store.signInWithGoogle();
    // Otherwise the page is already on its way to Google.
    if (trouble) {
      setMsg(trouble);
      setBusy(false);
    }
  };
  // Back from Google's page can bring this page back as it was left: ready to try again.
  useEffect(() => {
    const back = (ev: PageTransitionEvent) => {
      if (!ev.persisted) return;
      setBusy(false);
      setMsg("");
    };
    window.addEventListener("pageshow", back);
    return () => window.removeEventListener("pageshow", back);
  }, []);

  return (
    <section className="signin" id="loginView" hidden={hidden}>
      <div className="signin-top">
        <LogoMark size={120} />
        <h1 className="wordmark" translate="no">
          Gym Log
        </h1>
        <p className="tagline" id="tagline">
          Lifts, steps and recovery in one place.
        </p>
      </div>
      <div className="sheet">
        {store.googleSignIn ? (
          <button className="btn btn-outline btn-block" type="button" id="googleBtn" onClick={() => void google()} disabled={busy}>
            <GoogleG />
            Continue with Google
          </button>
        ) : null}
        {emailOpen ? (
          <form id="loginForm" className="login" onSubmit={submit}>
            <p className="sub" id="loginHow">
              {mode === "link" ? "We’ll email you a sign-in link. No password needed." : "Use the password you set in Settings."}
            </p>
            <label className="field" htmlFor="email">
              <span>Email</span>
              <input id="email" name="email" type="email" autoComplete="email" spellCheck={false} required placeholder="you@example.com" />
            </label>
            {mode === "password" ? (
              <label className="field" htmlFor="password">
                <span>Password</span>
                <input id="password" name="password" type="password" autoComplete="current-password" required />
              </label>
            ) : null}
            <button className="btn btn-primary btn-block" type="submit" id="loginBtn" disabled={busy || (mode === "link" && wait > 0)}>
              {mode === "password" ? "Sign in" : wait ? `Send another link in ${wait} s` : "Send sign-in link"}
            </button>
            <button className="btn btn-quiet btn-block" type="button" id="loginMode" onClick={switchMode}>
              {mode === "link" ? "Use a password instead" : "Email me a link instead"}
            </button>
          </form>
        ) : (
          <button
            className="btn btn-primary btn-block"
            type="button"
            id="emailBtn"
            onClick={() => {
              setEmailOpen(true);
              setTimeout(() => document.getElementById("email")?.focus(), 0);
            }}
          >
            <Mail size={20} aria-hidden="true" />
            Continue with email
          </button>
        )}
        <p className="note" id="loginMsg" aria-live="polite">
          {store.authMsg || msg}
        </p>
        <button type="button" className="btn btn-link btn-block" id="demoBtn" onClick={() => store.startDemo()}>
          Try it with sample data
        </button>
        <p className="note sheet-note">Sample mode saves nothing. Reloading ends it.</p>
      </div>
    </section>
  );
}
