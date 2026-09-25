"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useGym } from "@/hooks/useGym";
import { isNative } from "@/lib/native";

// Seconds before another link can be sent: Supabase refuses sooner, and a new link replaces the last one.
const WAIT = 60;

/** Google's "G", in its own colours as Google's sign-in button guidelines ask. */
function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Sign-in: Continue with Google (once it's set up), an emailed link, or a password set in Settings. */
export function LoginView({ hidden }: { hidden: boolean }) {
  const store = useGym();
  const [mode, setMode] = useState<"link" | "password">("link");
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
    <section className="panel" id="loginView" hidden={hidden}>
      <h2 className="display">Sign in</h2>
      {store.googleSignIn ? (
        <>
          <button className="gbtn" type="button" id="googleBtn" onClick={() => void google()} disabled={busy}>
            <GoogleG />
            Continue with Google
          </button>
          <p className="or" aria-hidden="true">
            <span>or with your email</span>
          </p>
        </>
      ) : null}
      <p className="sub">
        {mode === "link"
          ? "Enter your email to get a sign-in link. No password needed."
          : "Use the password you set in Settings. No password yet? Sign in with an email link, then Settings → Set a password."}
      </p>
      <form id="loginForm" className="login" onSubmit={submit}>
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
        <button className="primary" type="submit" id="loginBtn" disabled={busy || (mode === "link" && wait > 0)}>
          {mode === "password" ? "Sign in" : wait ? `Send another link in ${wait} s` : "Send sign-in link"}
        </button>
        <button className="ghost" type="button" id="loginMode" onClick={switchMode}>
          {mode === "link" ? "Use a password instead" : "Email me a link instead"}
        </button>
      </form>
      <p className="note" id="loginMsg" aria-live="polite">
        {store.authMsg || msg}
      </p>
      <p className="or" aria-hidden="true">
        <span>or</span>
      </p>
      <div className="login">
        <button type="button" className="ghost" id="demoBtn" onClick={() => store.startDemo()}>
          Try it with sample data
        </button>
        <p className="sub">No account needed. Nothing you enter is saved, and reloading ends it.</p>
      </div>
    </section>
  );
}
