"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useGym } from "@/hooks/useGym";

// Seconds before another link can be sent: Supabase refuses sooner, and a new link replaces the last one.
const WAIT = 60;

/** Sign-in by emailed link, or with a password set in Settings. */
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

  return (
    <section className="panel" id="loginView" hidden={hidden}>
      <h2 className="display">Sign in</h2>
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
    </section>
  );
}
