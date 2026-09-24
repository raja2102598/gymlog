"use client";
import { useState, type FormEvent } from "react";
import { useGym } from "@/hooks/useGym";

/** Sign-in by emailed link: no password. */
export function LoginView({ hidden }: { hidden: boolean }) {
  const store = useGym();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const send = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const email = (ev.currentTarget.elements.namedItem("email") as HTMLInputElement).value.trim();
    setBusy(true);
    setMsg("Sending…");
    const m = await store.sendLink(email);
    setBusy(false);
    setMsg(m);
  };
  return (
    <section className="panel" id="loginView" hidden={hidden}>
      <h2 className="display">Sign in</h2>
      <p className="sub">Enter your email and we&apos;ll send you a sign-in link. No password needed.</p>
      <form id="loginForm" className="login" onSubmit={send}>
        <label className="field" htmlFor="email">
          <span>Email</span>
          <input id="email" type="email" autoComplete="email" required placeholder="you@example.com" />
        </label>
        <button className="primary" type="submit" id="loginBtn" disabled={busy}>
          Email me a sign-in link
        </button>
      </form>
      <p className="note" id="loginMsg" aria-live="polite">
        {msg}
      </p>
    </section>
  );
}
