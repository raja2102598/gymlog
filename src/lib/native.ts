/* Whether this page runs inside the Android app (Capacitor adds window.Capacitor before the page loads). */

/** Where sign-in links send you in the Android app: it opens the app again. Listed in Supabase's Redirect URLs. */
export const NATIVE_SIGN_IN = "io.github.raja2102598.gymlog://login";

type CapacitorGlobal = { Capacitor?: { isNativePlatform?: () => boolean } };
export const isNative = (): boolean => typeof window !== "undefined" && !!(window as CapacitorGlobal).Capacitor?.isNativePlatform?.();
