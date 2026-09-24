/* Continue with Google in the Android app. Google won't sign in inside a web view, so the app's own plugin
 * (GoogleSignInPlugin.kt) opens Android's account sheet and returns Google's ID token, which Supabase turns into a
 * session. Loaded only in the app. */
import { registerPlugin } from "@capacitor/core";
import { GOOGLE_WEB_CLIENT_ID } from "@/lib/native";
import type { GymStore } from "@/lib/store";

interface GoogleSignInPlugin {
  signIn(o: { webClientId: string; nonce: string }): Promise<{ idToken: string; email: string }>;
}

const GoogleSignIn = registerPlugin<GoogleSignInPlugin>("GoogleSignIn");

const hex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const why = (e: unknown) => ((e as { message?: string }).message || String(e)).replace(/\.$/, "");

/** Signs in with the account picked on the phone. Returns what to show: empty once signed in, or if you cancelled. */
export async function signInWithGoogle(store: GymStore): Promise<string> {
  // A new nonce each time: Google puts its SHA-256 in the token, Supabase gets the nonce itself and checks they match,
  // so a token can't be replayed for another sign-in.
  const nonce = hex(crypto.getRandomValues(new Uint8Array(32)));
  const hashed = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce)));
  let idToken: string;
  try {
    ({ idToken } = await GoogleSignIn.signIn({ webClientId: GOOGLE_WEB_CLIENT_ID, nonce: hashed }));
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "cancelled") return "";
    if (code === "no_account") return "There’s no Google account on this phone. Add one in the phone’s Settings → Accounts, or sign in with your email.";
    return `Couldn’t sign in with Google: ${why(e)}. Try again, or sign in with your email.`;
  }
  return store.signInWithIdToken(idToken, nonce);
}
