/* Speech to text for voice logging. On the website it's the browser's Web Speech API: in Chrome the audio goes to
 * Google to be turned into text. The Android app's WebView has none, so there the app's own plugin
 * (src/native/speech.ts) uses the phone's speech recognition, on the phone itself where it can. Whether to offer it
 * is a switch in Settings, kept on this device only, like the theme. */
import { isNative } from "./native";
import { lsGet, lsSet } from "./storage";

/** The parts of SpeechRecognition used here: TypeScript's DOM types have its results, not the recognizer. */
interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: SpeechRecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onnomatch: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type RecognizerClass = new () => Recognizer;
type SpeechGlobals = { SpeechRecognition?: RecognizerClass; webkitSpeechRecognition?: RecognizerClass };

const recognizer = (): RecognizerClass | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as SpeechGlobals;
  return w.SpeechRecognition || w.webkitSpeechRecognition;
};

// The Android app's plugin, loaded only there, and whether the phone has said it can listen.
const phone = () => import("@/native/speech");
let phoneCan = false;

/** This device can turn speech into text: the browser can, or in the Android app, the phone has said it can. */
export const speechSupported = (): boolean => (isNative() ? phoneCan : !!recognizer());

/** Asks the phone whether it can turn speech into text: the Android app does, once, as it starts. Until it answers,
 *  voice isn't offered there; when the answer changes that, whoever follows the switch (onVoicePref) hears. */
export async function checkPhoneSpeech(): Promise<void> {
  const can = await phone()
    .then((m) => m.available())
    .catch(() => false);
  if (can === phoneCan) return;
  phoneCan = can;
  tell();
}

/** Why listening ended without words: the Web Speech API's error ("no-speech", "not-allowed", "aborted", "network",
 *  …), "no-speech" when it ended in silence, or "no-match" when it heard something it couldn't make out. The Android
 *  app's plugin gives the same reasons. */
export class SpeechError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Speech recognition: ${reason}`);
    this.name = "SpeechError";
    this.reason = reason;
  }
}

/** The language to listen in. What's heard is read by an English parser (src/lib/voice.ts), so it's English: the
 *  browser's own English (en-IN, en-GB, …) when it lists one, as that knows the accent, and otherwise en-US. In the
 *  Android app the WebView lists the phone's languages, and the plugin listens in this one too. */
export function recognitionLang(): string {
  const listed = typeof navigator === "undefined" ? [] : [...(navigator.languages ?? []), navigator.language];
  return listed.find((l) => /^en(-|$)/i.test(l ?? "")) ?? "en-US";
}

/**
 * Listens for one phrase and resolves with the recognizer's guesses at it, best first (up to 5). Rejects with a
 * SpeechError on an error or silence, and with "aborted" as soon as `signal` aborts.
 */
export function listenOnce({ lang = recognitionLang(), signal }: { lang?: string; signal?: AbortSignal } = {}): Promise<string[]> {
  if (isNative()) return listenOnPhone(lang, signal);
  return new Promise((resolve, reject) => {
    const Recognition = recognizer();
    if (!Recognition) return reject(new SpeechError("not-supported"));
    if (signal?.aborted) return reject(new SpeechError("aborted"));
    const rec = new Recognition();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 5;
    let settled = false;
    const settle = (heard: string[] | SpeechError) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", stop);
      if (heard instanceof SpeechError) reject(heard);
      else resolve(heard);
    };
    function stop() {
      settle(new SpeechError("aborted"));
      rec.abort();
    }
    rec.onresult = (e) => {
      const r = e.results[e.results.length - 1];
      const heard = Array.from({ length: r?.length ?? 0 }, (_, i) => r[i].transcript.trim()).filter(Boolean);
      settle(heard.length ? heard : new SpeechError("no-speech"));
    };
    rec.onerror = (e) => settle(new SpeechError(e.error || "failed"));
    rec.onnomatch = () => settle(new SpeechError("no-match"));
    rec.onend = () => settle(new SpeechError("no-speech"));
    signal?.addEventListener("abort", stop);
    try {
      rec.start();
    } catch (e) {
      settle(new SpeechError((e as { name?: string } | null)?.name === "NotAllowedError" ? "not-allowed" : "failed"));
    }
  });
}

/** The codes the app's plugin rejects with (SpeechPlugin.kt), which are the browser's reasons. Anything else is "failed". */
const PHONE_REASONS = new Set(["no-speech", "no-match", "not-allowed", "network", "aborted"]);
const codeOf = (e: unknown): unknown => (e as { code?: unknown } | null)?.code;

/** listenOnce in the Android app: the phone's speech recognition, through the app's plugin. Without the microphone
 *  (Android's "Only this time" lapses, and it can be taken back), the tap asks for it again first. */
function listenOnPhone(lang: string, signal?: AbortSignal): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (!phoneCan) return reject(new SpeechError("not-supported"));
    if (signal?.aborted) return reject(new SpeechError("aborted"));
    let settled = false;
    const settle = (heard: string[] | SpeechError) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", stop);
      if (heard instanceof SpeechError) reject(heard);
      else resolve(heard);
    };
    function stop() {
      settle(new SpeechError("aborted"));
      void phone()
        .then((m) => m.stop())
        .catch(() => {});
    }
    signal?.addEventListener("abort", stop);
    phone()
      .then((m) =>
        settled
          ? []
          : m.listen(lang).catch(async (e: unknown) => {
              if (codeOf(e) !== "not-allowed" || !(await m.allowMicrophone().catch(() => false)) || settled) throw e;
              return m.listen(lang);
            }),
      )
      .then((said) => {
        const heard = said.map((t) => t.trim()).filter(Boolean);
        settle(heard.length ? heard : new SpeechError("no-speech"));
      })
      .catch((e: unknown) => {
        const code = codeOf(e);
        settle(new SpeechError(typeof code === "string" && PHONE_REASONS.has(code) ? code : "failed"));
      });
  });
}

/* ---------- the switch in Settings ---------- */

export const VOICE_KEY = "gymlog.voice.v1";
const listeners = new Set<() => void>();
const tell = () => {
  for (const fn of listeners) fn();
};

/** Whether "Log sets by voice" is on, on this device. Off until it's switched on. */
export const voicePref = (): boolean => lsGet<unknown>(VOICE_KEY, false) === true;

export function setVoicePref(on: boolean) {
  lsSet(VOICE_KEY, on);
  tell();
}

/** The switch, as Settings flips it. In the Android app, switching it on asks for the microphone first (Android's
 *  permission sheet); if that's refused, it stays off and this resolves false. */
export async function switchVoice(on: boolean): Promise<boolean> {
  if (on && isNative() && !(await phone().then((m) => m.allowMicrophone()).catch(() => false))) return false;
  setVoicePref(on);
  return true;
}

/** Calls `fn` when the switch changes, and when the Android app hears whether the phone can listen: for
 *  useSyncExternalStore. Returns the unsubscribe. */
export function onVoicePref(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
