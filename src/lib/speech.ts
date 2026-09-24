/* Speech to text for voice logging, through the browser's Web Speech API. In Chrome the audio goes to Google to be
 * turned into text. The Android app's WebView has no speech recognition, so there it's off. Whether to offer it is
 * a switch in Settings, kept on this device only, like the theme. */
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

/** The browser can turn speech into text, and this isn't the Android app. */
export const speechSupported = (): boolean => !!recognizer() && !isNative();

/** Why listening ended without words: the Web Speech API's error ("no-speech", "not-allowed", "aborted", "network",
 *  …), "no-speech" when it ended in silence, or "no-match" when it heard something it couldn't make out. */
export class SpeechError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Speech recognition: ${reason}`);
    this.name = "SpeechError";
    this.reason = reason;
  }
}

/** The language to listen in. What's heard is read by an English parser (src/lib/voice.ts), so it's English: the
 *  browser's own English (en-IN, en-GB, …) when it lists one, as that knows the accent, and otherwise en-US. */
export function recognitionLang(): string {
  const listed = typeof navigator === "undefined" ? [] : [...(navigator.languages ?? []), navigator.language];
  return listed.find((l) => /^en(-|$)/i.test(l ?? "")) ?? "en-US";
}

/**
 * Listens for one phrase and resolves with the recognizer's guesses at it, best first (up to 5). Rejects with a
 * SpeechError on an error or silence, and with "aborted" as soon as `signal` aborts.
 */
export function listenOnce({ lang = recognitionLang(), signal }: { lang?: string; signal?: AbortSignal } = {}): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const Recognition = recognizer();
    if (!Recognition || isNative()) return reject(new SpeechError("not-supported"));
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

/* ---------- the switch in Settings ---------- */

export const VOICE_KEY = "gymlog.voice.v1";
const listeners = new Set<() => void>();

/** Whether "Log sets by voice" is on, on this device. Off until it's switched on. */
export const voicePref = (): boolean => lsGet<unknown>(VOICE_KEY, false) === true;

export function setVoicePref(on: boolean) {
  lsSet(VOICE_KEY, on);
  for (const fn of listeners) fn();
}

/** Calls `fn` when the switch changes, for useSyncExternalStore. Returns the unsubscribe. */
export function onVoicePref(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
