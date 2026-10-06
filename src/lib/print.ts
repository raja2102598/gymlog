/* Printing a page of the app's own making (the plan, lib/planShare.ts), or saving it as a PDF from the print dialog. A
 * browser prints it from a hidden frame; the Android app's WebView can't print, so there Android's own print service
 * does it (PrintPlugin.kt), whose dialog offers Save as PDF too. */
import { registerPlugin } from "@capacitor/core";
import { isNative } from "./native";

interface PrintPlugin {
  print(o: { html: string; name: string }): Promise<void>;
}
const Printer = registerPlugin<PrintPlugin>("GymPrint");

/** Opens the print dialog for `html`, a whole page, under `name` (the PDF's name, where it's saved as one). */
export async function printHtml(html: string, name: string): Promise<void> {
  if (isNative()) return Printer.print({ html, name });
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  await new Promise<void>((done) => {
    frame.onload = () => done();
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  // The dialog blocks until it's closed; the frame goes after, so a slow dialog still has the page to print.
  setTimeout(() => frame.remove(), 1000);
}
