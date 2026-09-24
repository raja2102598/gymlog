"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { listenOnce, onVoicePref, SpeechError, voicePref } from "@/lib/speech";
import { bestAlternative, type VoiceResult } from "@/lib/voice";

/** Whether "Log sets by voice" is on, on this device. Follows the switch in Settings as it changes. */
export const useVoicePref = (): boolean => useSyncExternalStore(onVoicePref, voicePref, () => false);

/** What to say when listening brought back no words; nothing when it was stopped. */
function trouble(reason: string): string {
  if (reason === "aborted") return "";
  if (reason === "no-speech") return "Didn’t hear anything. Try again.";
  if (reason === "no-match") return "Didn’t catch that. Say it like “10\u00a0at\u00a045”.";
  if (reason === "not-allowed" || reason === "service-not-allowed") return "Allow the microphone for this site to log by voice.";
  if (reason === "network") return "Couldn’t reach speech recognition. Check your connection, then try again.";
  return "Couldn’t listen just now. Try again, or type the set.";
}

/** The card listening now. One at a time: tapping another card's microphone stops this one. */
let active: AbortController | null = null;

/**
 * Voice on one lift card. `listen` hears one phrase (tapping again stops it) and hands the best reading of it to
 * `apply`, which acts on it and returns what to say; that line shows for about 4 seconds. Listening stops when
 * `enabled` goes false or the card goes away.
 */
export function useVoice(enabled: boolean, apply: (said: VoiceResult, heard: string) => string) {
  const [listening, setListening] = useState(false);
  // A new object for each line, so the same words twice still show for the full 4 seconds.
  const [line, setLine] = useState<{ text: string } | null>(null);
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) ctl.current?.abort();
  }, [enabled]);
  useEffect(() => () => ctl.current?.abort(), []);
  useEffect(() => {
    if (!line) return;
    const t = setTimeout(() => setLine(null), 4000);
    return () => clearTimeout(t);
  }, [line]);

  const listen = async () => {
    if (ctl.current) return ctl.current.abort();
    const c = (ctl.current = new AbortController());
    active?.abort();
    active = c;
    setLine(null);
    setListening(true);
    const heard = await listenOnce({ signal: c.signal }).catch((e: unknown) => (e instanceof SpeechError ? e : new SpeechError("failed")));
    if (ctl.current === c) ctl.current = null;
    if (active === c) active = null;
    setListening(false);
    let text: string;
    if (heard instanceof SpeechError) text = trouble(heard.reason);
    else {
      const best = bestAlternative(heard);
      text = apply(best.result, best.text);
    }
    if (text) setLine({ text });
  };

  return { listening, line: line?.text ?? "", listen };
}
