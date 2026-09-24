import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listenOnce, onVoicePref, recognitionLang, setVoicePref, SpeechError, speechSupported, VOICE_KEY, voicePref } from "@/lib/speech";

type Handler<E> = ((e: E) => void) | null;
/** Chrome's recognizer, as far as the app uses it: records how it was set up, and answers when told to. */
class FakeRecognition {
  static made: FakeRecognition[] = [];
  lang = "";
  continuous = true;
  interimResults = true;
  maxAlternatives = 1;
  onresult: Handler<{ results: unknown }> = null;
  onerror: Handler<{ error: string }> = null;
  onnomatch: (() => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  aborted = false;
  constructor() {
    FakeRecognition.made.push(this);
  }
  start() {
    this.started = true;
  }
  abort() {
    this.aborted = true;
    this.onerror?.({ error: "aborted" });
    this.onend?.();
  }
  /** Hears a phrase: the recognizer's guesses, best first. */
  hear(...alternatives: string[]) {
    this.onresult?.({ results: [Object.assign(alternatives.map((transcript) => ({ transcript, confidence: 0.8 })), { isFinal: true })] });
    this.onend?.();
  }
  fail(error: string) {
    this.onerror?.({ error });
    this.onend?.();
  }
}
const rec = () => FakeRecognition.made[FakeRecognition.made.length - 1];
const reason = (p: Promise<unknown>) => p.then(() => "resolved", (e: unknown) => (e instanceof SpeechError ? e.reason : `not a SpeechError: ${String(e)}`));

beforeEach(() => {
  FakeRecognition.made = [];
  const kept = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) });
  vi.stubGlobal("navigator", { language: "en-GB" });
});
afterEach(() => vi.unstubAllGlobals());

describe("speechSupported", () => {
  it("is false without the Web Speech API", () => {
    expect(speechSupported()).toBe(false);
    vi.stubGlobal("window", {});
    expect(speechSupported()).toBe(false);
  });
  it("is true with SpeechRecognition or webkitSpeechRecognition", () => {
    vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition });
    expect(speechSupported()).toBe(true);
    vi.stubGlobal("window", { SpeechRecognition: FakeRecognition });
    expect(speechSupported()).toBe(true);
  });
  it("is false in the Android app, even where the WebView has it", () => {
    vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition, Capacitor: { isNativePlatform: () => true } });
    expect(speechSupported()).toBe(false);
  });
});

describe("recognitionLang", () => {
  it("is the browser's language when that's English", () => {
    expect(recognitionLang()).toBe("en-GB");
    vi.stubGlobal("navigator", { language: "en", languages: ["en"] });
    expect(recognitionLang()).toBe("en");
  });
  it("is the first English the browser lists, when its own language isn't English", () => {
    vi.stubGlobal("navigator", { language: "hi-IN", languages: ["hi-IN", "en-IN", "en-US"] });
    expect(recognitionLang()).toBe("en-IN");
  });
  it("is en-US when the browser lists no English, as the parser reads only English", () => {
    vi.stubGlobal("navigator", { language: "fr-FR", languages: ["fr-FR", "fr"] });
    expect(recognitionLang()).toBe("en-US");
    vi.stubGlobal("navigator", { language: "fr-FR" });
    expect(recognitionLang()).toBe("en-US");
  });
  it("a listenOnce in a French browser listens in English", async () => {
    vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition });
    vi.stubGlobal("navigator", { language: "fr-FR", languages: ["fr-FR"] });
    const heard = listenOnce();
    expect(rec().lang).toBe("en-US");
    rec().hear("10 at 45");
    await expect(heard).resolves.toEqual(["10 at 45"]);
  });
});

describe("listenOnce", () => {
  beforeEach(() => vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition }));

  it("listens once, for up to 5 guesses, in the browser's English, and resolves with what it heard", async () => {
    const heard = listenOnce();
    expect(rec()).toMatchObject({ started: true, lang: "en-GB", continuous: false, interimResults: false, maxAlternatives: 5 });
    rec().hear(" ten at forty five", "10 at 45", "");
    await expect(heard).resolves.toEqual(["ten at forty five", "10 at 45"]);
    const other = listenOnce({ lang: "hi-IN" });
    expect(rec().lang).toBe("hi-IN");
    rec().hear("done");
    await expect(other).resolves.toEqual(["done"]);
  });

  it("uses the unprefixed SpeechRecognition when there is one", async () => {
    class Unprefixed extends FakeRecognition {}
    vi.stubGlobal("window", { SpeechRecognition: Unprefixed, webkitSpeechRecognition: FakeRecognition });
    const heard = listenOnce();
    expect(rec()).toBeInstanceOf(Unprefixed);
    rec().hear("again");
    await expect(heard).resolves.toEqual(["again"]);
  });

  it("rejects with the reason on an error, on silence, and on no words", async () => {
    let p = listenOnce();
    rec().fail("not-allowed");
    expect(await reason(p)).toBe("not-allowed");
    p = listenOnce();
    rec().fail("no-speech");
    expect(await reason(p)).toBe("no-speech");
    p = listenOnce();
    rec().onend?.();
    expect(await reason(p)).toBe("no-speech");
    p = listenOnce();
    rec().hear("", "  ");
    expect(await reason(p)).toBe("no-speech");
    p = listenOnce();
    rec().onnomatch?.();
    expect(await reason(p)).toBe("no-match");
  });

  it("stops when its signal aborts, and doesn't start when it already has", async () => {
    const stop = new AbortController();
    const p = listenOnce({ signal: stop.signal });
    stop.abort();
    expect(await reason(p)).toBe("aborted");
    expect(rec().aborted).toBe(true);
    rec().hear("10 at 45"); // too late: already settled
    const n = FakeRecognition.made.length;
    expect(await reason(listenOnce({ signal: stop.signal }))).toBe("aborted");
    expect(FakeRecognition.made.length).toBe(n);
  });

  it("rejects straight away where speech isn't supported", async () => {
    vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition, Capacitor: { isNativePlatform: () => true } });
    expect(await reason(listenOnce())).toBe("not-supported");
    expect(FakeRecognition.made.length).toBe(0);
  });
});

describe("the Log sets by voice switch", () => {
  it("is off until switched on, is kept on this device, and tells whoever listens", () => {
    expect(voicePref()).toBe(false);
    const heard = vi.fn();
    const stop = onVoicePref(heard);
    setVoicePref(true);
    expect(voicePref()).toBe(true);
    expect(localStorage.getItem(VOICE_KEY)).toBe("true");
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    setVoicePref(false);
    expect(voicePref()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("reads anything but true as off", () => {
    localStorage.setItem(VOICE_KEY, '"yes"');
    expect(voicePref()).toBe(false);
    localStorage.setItem(VOICE_KEY, "not json");
    expect(voicePref()).toBe(false);
  });
});
