/* The phone's Back (the gesture, or the button): what it closes, most recent first. The Android app sends it here
 * (native/app.ts); a screen that has something open registers a handler that closes it and says it did. */

type Handler = () => boolean;
const handlers: Handler[] = [];

/** Adds a handler, tried before the ones added earlier. Returns its removal. */
export function onBack(fn: Handler): () => void {
  handlers.push(fn);
  return () => {
    const i = handlers.lastIndexOf(fn);
    if (i >= 0) handlers.splice(i, 1);
  };
}

/** Runs the handlers, newest first, until one closes something. False when none did: the app is at its start. */
export function runBack(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i]()) return true;
  return false;
}

/** Back, as the Android app does it: an open dialog (the exercise library) closes first, then whatever the screens
 *  registered (an open menu, a page to leave); with nothing left, `atStart` (the app goes to the background). */
export function handleBack(doc: Pick<Document, "querySelector">, atStart: () => void): void {
  const dialog = doc.querySelector<HTMLDialogElement>("dialog[open]");
  if (dialog) {
    dialog.close();
    return;
  }
  if (!runBack()) atStart();
}
