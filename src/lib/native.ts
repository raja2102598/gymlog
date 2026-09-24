/* Whether this page runs inside the Android app (Capacitor adds window.Capacitor before the page loads). */
import { SITE_URL } from "./config";

/** Continue with Google in the Android app: the OAuth *Web* client ID (config.ts; empty keeps the button hidden). */
export { GOOGLE_WEB_CLIENT_ID } from "./config";

/** The app's own address for sign-in links: public/app-login.html opens it (and version 1.0.1's links used it). */
export const NATIVE_SIGN_IN = "io.github.raja2102598.gymlog://login";

/** Where sign-in links from the Android app land first: a page on the site that hands the link to the app.
 *  Being on the site's address, Supabase accepts it with the link's flow id added (see GymStore.sendLink). */
export const APP_LOGIN_PAGE = SITE_URL ? `${SITE_URL}/app-login.html` : "";

type CapacitorGlobal = { Capacitor?: { isNativePlatform?: () => boolean } };
export const isNative = (): boolean => typeof window !== "undefined" && !!(window as CapacitorGlobal).Capacitor?.isNativePlatform?.();
