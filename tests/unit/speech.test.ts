import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Android app's own Speech plugin (SpeechPlugin.kt), answering as the app would.
const plugin = vi.hoisted(() => ({
  available: vi.fn(),
  listen: vi.fn(),
  stop: vi.fn(),
  requestPermissions: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ registerPlugin: (name: string) => (name === "Speech" ? plugin : undefined) }));

import {
  checkPhoneSpeech,
  listenOnce,
  onVoicePref,
  recognitionLang,
  setVoicePref,
  SpeechError,
  speechSupported,
  switchVoice,
  VOICE_KEY,
  voicePref,
} from "@/lib/speech";

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
  for (const f of Object.values(plugin)) f.mockReset();
  plugin.stop.mockResolvedValue(undefined);
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
  it("is false in the Android app until the phone says it can listen, even where the WebView has it", () => {
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

  it("on the website, flips straight away and asks for nothing", () => {
    vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition });
    void switchVoice(true);
    expect(voicePref()).toBe(true);
    void switchVoice(false);
    expect(voicePref()).toBe(false);
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });
});

describe("in the Android app", () => {
  /** The phone's answer to whether it can listen, as the app asks it when it starts. */
  const phoneCan = async (available: boolean) => {
    plugin.available.mockResolvedValue({ available });
    await checkPhoneSpeech();
  };
  // The WebView may have a recognizer of its own; the app doesn't use it.
  beforeEach(() => vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition, Capacitor: { isNativePlatform: () => true } }));
  afterEach(() => phoneCan(false));

  it("offers speech once the phone says it can, and tells whoever follows the switch", async () => {
    expect(speechSupported()).toBe(false);
    const heard = vi.fn();
    const stop = onVoicePref(heard);
    await phoneCan(true);
    expect(plugin.available).toHaveBeenCalledTimes(1);
    expect(speechSupported()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    await phoneCan(true);
    expect(heard).toHaveBeenCalledTimes(1);
    await phoneCan(false);
    expect(speechSupported()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stays off when the phone can't listen, or the plugin fails", async () => {
    await phoneCan(false);
    expect(speechSupported()).toBe(false);
    plugin.available.mockRejectedValue(new Error('"Speech" plugin is not implemented on android'));
    await checkPhoneSpeech();
    expect(speechSupported()).toBe(false);
  });

  it("leaves the website to the browser", async () => {
    await phoneCan(true);
    vi.stubGlobal("window", {});
    expect(speechSupported()).toBe(false);
    vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition });
    expect(speechSupported()).toBe(true);
    const heard = listenOnce();
    rec().hear("done");
    await expect(heard).resolves.toEqual(["done"]);
    expect(plugin.listen).not.toHaveBeenCalled();
  });

  it("listens through the plugin, in the phone's English, and resolves its guesses", async () => {
    await phoneCan(true);
    plugin.listen.mockResolvedValue({ matches: [" ten at forty five", "10 at 45", ""] });
    await expect(listenOnce()).resolves.toEqual(["ten at forty five", "10 at 45"]);
    expect(plugin.listen).toHaveBeenCalledWith({ lang: "en-GB" });
    // The WebView lists the phone's languages: a Hindi phone with English as well listens in its English.
    vi.stubGlobal("navigator", { language: "hi-IN", languages: ["hi-IN", "en-IN"] });
    plugin.listen.mockResolvedValue({ matches: ["done"] });
    await expect(listenOnce()).resolves.toEqual(["done"]);
    expect(plugin.listen).toHaveBeenLastCalledWith({ lang: "en-IN" });
    vi.stubGlobal("navigator", { language: "hi-IN", languages: ["hi-IN"] });
    await listenOnce();
    expect(plugin.listen).toHaveBeenLastCalledWith({ lang: "en-US" });
    expect(FakeRecognition.made).toHaveLength(0);
    plugin.listen.mockResolvedValue({ matches: ["", "  "] });
    expect(await reason(listenOnce())).toBe("no-speech");
  });

  it("gives the plugin's codes as the browser's reasons, and anything else as failed", async () => {
    await phoneCan(true);
    plugin.requestPermissions.mockResolvedValue({ microphone: "denied" });
    const codes: [string | undefined, string][] = [
      ["no-speech", "no-speech"],
      ["no-match", "no-match"],
      ["not-allowed", "not-allowed"],
      ["network", "network"],
      ["aborted", "aborted"],
      ["failed", "failed"],
      ["busy", "failed"],
      [undefined, "failed"],
    ];
    for (const [code, want] of codes) {
      plugin.listen.mockRejectedValueOnce(Object.assign(new Error("Speech recognition error"), { code }));
      expect(await reason(listenOnce()), String(code)).toBe(want);
    }
  });

  it("stops the plugin when its signal aborts, and doesn't start when it already has", async () => {
    await phoneCan(true);
    let answer: (e: unknown) => void = () => {};
    plugin.listen.mockImplementation(() => new Promise((_, reject) => (answer = reject)));
    const stop = new AbortController();
    const p = listenOnce({ signal: stop.signal });
    await vi.waitFor(() => expect(plugin.listen).toHaveBeenCalledTimes(1));
    stop.abort();
    expect(await reason(p)).toBe("aborted");
    await vi.waitFor(() => expect(plugin.stop).toHaveBeenCalledTimes(1));
    answer(Object.assign(new Error("Stopped listening"), { code: "aborted" })); // the plugin's own answer: already settled
    expect(await reason(listenOnce({ signal: stop.signal }))).toBe("aborted");
    // Aborted before the plugin was even asked: it isn't.
    const again = new AbortController();
    const q = listenOnce({ signal: again.signal });
    again.abort();
    expect(await reason(q)).toBe("aborted");
    await vi.waitFor(() => expect(plugin.stop).toHaveBeenCalledTimes(2));
    expect(plugin.listen).toHaveBeenCalledTimes(1);
  });

  it("asks for the microphone again when it's gone (Android's “Only this time”), then listens", async () => {
    await phoneCan(true);
    const notAllowed = () => Object.assign(new Error("Gym Log isn't allowed to use the microphone"), { code: "not-allowed" });
    plugin.listen.mockRejectedValueOnce(notAllowed()).mockResolvedValueOnce({ matches: ["10 at 45"] });
    plugin.requestPermissions.mockResolvedValueOnce({ microphone: "granted" });
    await expect(listenOnce()).resolves.toEqual(["10 at 45"]);
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(plugin.listen).toHaveBeenCalledTimes(2);
    // Refused again (or refused for good, when Android doesn't ask): not allowed, and it doesn't listen.
    plugin.listen.mockRejectedValueOnce(notAllowed());
    plugin.requestPermissions.mockResolvedValueOnce({ microphone: "denied" });
    expect(await reason(listenOnce())).toBe("not-allowed");
    expect(plugin.listen).toHaveBeenCalledTimes(3);
    // Stopped while Android asked: it doesn't listen after all.
    const stop = new AbortController();
    let answer: (v: unknown) => void = () => {};
    plugin.listen.mockRejectedValueOnce(notAllowed());
    plugin.requestPermissions.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const p = listenOnce({ signal: stop.signal });
    await vi.waitFor(() => expect(plugin.requestPermissions).toHaveBeenCalledTimes(3));
    stop.abort();
    answer({ microphone: "granted" });
    expect(await reason(p)).toBe("aborted");
    await vi.waitFor(() => expect(plugin.stop).toHaveBeenCalledTimes(1));
    expect(plugin.listen).toHaveBeenCalledTimes(4);
  });

  it("rejects straight away until the phone has said it can listen", async () => {
    expect(await reason(listenOnce())).toBe("not-supported");
    expect(plugin.listen).not.toHaveBeenCalled();
    expect(FakeRecognition.made).toHaveLength(0);
  });

  it("asks for the microphone when the switch goes on, and stays off when that's refused", async () => {
    await phoneCan(true);
    const heard = vi.fn();
    const stop = onVoicePref(heard);
    for (const microphone of ["denied", "prompt-with-rationale"]) {
      plugin.requestPermissions.mockResolvedValueOnce({ microphone });
      expect(await switchVoice(true)).toBe(false);
      expect(voicePref()).toBe(false);
    }
    plugin.requestPermissions.mockRejectedValueOnce(new Error("Missing the following permissions in AndroidManifest.xml"));
    expect(await switchVoice(true)).toBe(false);
    expect(voicePref()).toBe(false);
    expect(localStorage.getItem(VOICE_KEY)).toBeNull();
    expect(heard).not.toHaveBeenCalled();
    plugin.requestPermissions.mockResolvedValueOnce({ microphone: "granted" });
    expect(await switchVoice(true)).toBe(true);
    expect(voicePref()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(4);
    // Switching it off asks nothing.
    expect(await switchVoice(false)).toBe(true);
    expect(voicePref()).toBe(false);
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(4);
    // A second tap while Android's sheet is up waits for the same answer instead of asking twice.
    let answer: (v: unknown) => void = () => {};
    plugin.requestPermissions.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const first = switchVoice(true), second = switchVoice(true);
    await vi.waitFor(() => expect(plugin.requestPermissions).toHaveBeenCalledTimes(5));
    answer({ microphone: "granted" });
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(5);
    expect(voicePref()).toBe(true);
    stop();
  });
});
