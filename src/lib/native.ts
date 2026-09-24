/* Whether this page runs inside the Android app (Capacitor adds window.Capacitor before the page loads). */

/** The app's own address for sign-in links: public/app-login.html opens it (and version 1.0.1's links used it). */
export const NATIVE_SIGN_IN = "io.github.raja2102598.gymlog://login";

/** Where sign-in links from the Android app land first: a page on the live site that hands the link to the app.
 *  Being on the site's address, Supabase accepts it with the link's flow id added (see GymStore.sendLink). */
export const APP_LOGIN_PAGE = "https://gym-log-omega-seven.vercel.app/app-login.html";

/** Continue with Google in the Android app: the OAuth *Web* client ID from Google Cloud (public, like the address of
 *  a sign-in page; its secret lives only in Supabase). Empty until set up, which keeps the app's Google button hidden.
 *  README.md, Continue with Google, has the steps. */
export const GOOGLE_WEB_CLIENT_ID = "";

type CapacitorGlobal = { Capacitor?: { isNativePlatform?: () => boolean } };
export const isNative = (): boolean => typeof window !== "undefined" && !!(window as CapacitorGlobal).Capacitor?.isNativePlatform?.();
