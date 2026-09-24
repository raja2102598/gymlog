/* Voice logging in the Android app. The app's web view has no speech recognition, so the app's own plugin
 * (SpeechPlugin.kt) listens with Android's, on the phone itself where it can. src/lib/speech.ts loads this only in
 * the app, so the website doesn't carry it. */
import { registerPlugin, type PermissionState } from "@capacitor/core";

interface SpeechPlugin {
  available(): Promise<{ available: boolean }>;
  /** Up to 5 guesses at one phrase, best first. Rejects with a code that is one of the browser's reasons: "no-speech",
   *  "no-match", "not-allowed", "network", "aborted" or "failed". */
  listen(o: { lang: string }): Promise<{ matches: string[] }>;
  /** Stops a listen in progress, which then rejects with "aborted". */
  stop(): Promise<void>;
  requestPermissions(): Promise<{ microphone: PermissionState }>;
}

const Speech = registerPlugin<SpeechPlugin>("Speech");

/** Whether the phone can turn speech into text at all. */
export const available = async (): Promise<boolean> => (await Speech.available()).available === true;

/** The phone's guesses at one phrase, best first. */
export const listen = async (lang: string): Promise<string[]> => (await Speech.listen({ lang })).matches;

export const stop = (): Promise<void> => Speech.stop();

let asking: Promise<boolean> | undefined;

/** Asks for the microphone: Android's permission sheet, unless it's been allowed already or refused for good. True
 *  once it's allowed. Asked again while the sheet is up, it waits for the same answer. */
export function allowMicrophone(): Promise<boolean> {
  asking ??= Speech.requestPermissions()
    .then((r) => r.microphone === "granted")
    .finally(() => {
      asking = undefined;
    });
  return asking;
}
