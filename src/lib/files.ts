/* Files the app hands over: an export, or a plan to share. */

/** Hands `text` to the browser as a file to download. */
export function download(name: string, type: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Offers `text` as a file to the phone's share sheet where the browser has one for files (Chrome on Android), or else
 *  downloads it. Says which it did; "cancelled" when the share sheet was closed without sharing. */
export async function shareFile(name: string, type: string, text: string, title: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = typeof File === "function" ? new File([text], name, { type }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (err) {
      if ((err as Error).name === "AbortError") return "cancelled";
    }
  }
  download(name, type, text);
  return "downloaded";
}
