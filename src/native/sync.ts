/* Background sync in the Android app: the app's own GymSync plugin (android/app/.../GymSyncPlugin.kt) reads Health
 * Connect about every hour, even when the app is closed, and saves days with this phone's sync key
 * (public.sync_health_days in supabase/schema.sql). Settings turns it on and off here. */
import { registerPlugin } from "@capacitor/core";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";
import { lsGet, lsSet } from "@/lib/storage";
import type { GymStore } from "@/lib/store";

export interface SyncStatus {
  /** Background sync is on on this phone. */
  on: boolean;
  /** This phone's Health Connect lets apps read in the background at all. */
  available: boolean;
  /** Gym Log has that permission. */
  allowed: boolean;
  /** The last background run: when (ms, 0 for never), whether it worked, and what it said. */
  lastRunAt: number;
  lastOk: boolean;
  lastMsg: string;
}

interface GymSyncPlugin {
  status(): Promise<SyncStatus>;
  requestBackground(): Promise<{ available: boolean; allowed: boolean }>;
  enable(o: { key: string; url: string; anonKey: string }): Promise<void>;
  disable(): Promise<void>;
  runNow(): Promise<void>;
}

const GymSync = registerPlugin<GymSyncPlugin>("GymSync");

// Names this phone's key, so turning background sync on again replaces its key instead of adding one.
const DEVICE_KEY = "gymlog.device.v1";
export function deviceName(): string {
  let id = lsGet<string>(DEVICE_KEY, "");
  if (!id) {
    id = `android-${crypto.randomUUID().slice(0, 8)}`;
    lsSet(DEVICE_KEY, id);
  }
  return id;
}

export const backgroundStatus = (): Promise<SyncStatus> => GymSync.status();

// The account background sync saves to, so another account signing in on this phone doesn't inherit it.
const OWNER_KEY = "gymlog.bgsync.user.v1";

/** Turns background sync on: Health Connect's background permission, then a key for this phone. Returns what to show. */
export async function turnOnBackground(store: GymStore): Promise<string> {
  const perm = await GymSync.requestBackground();
  if (!perm.available)
    return "This phone’s Health Connect can’t read in the background yet. A Google Play system update may add it; until then Gym Log syncs whenever you open it.";
  if (!perm.allowed) return "Background sync needs Health Connect’s “Access data in the background”. Allow it, then turn this on again.";
  if (!store.sb || !store.user) return "Sign in first.";
  const { data, error } = await store.sb.rpc("create_health_sync_key", { device_name: deviceName() });
  if (error || typeof data !== "string") return `Couldn’t turn on background sync: ${error?.message ?? "no key came back"}. Check your connection, then try again.`;
  await GymSync.enable({ key: data, url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
  lsSet(OWNER_KEY, store.user.id);
  return "Background sync is on. Gym Log reads Health Connect about every hour, even when it’s closed.";
}

/** Turns it off on this phone and removes the phone's key from Supabase. */
export async function turnOffBackground(store: GymStore): Promise<string> {
  await GymSync.disable();
  lsSet(OWNER_KEY, null);
  const gone = store.sb ? await store.sb.from("health_sync_keys").delete().eq("device", deviceName()) : null;
  return gone?.error
    ? `Background sync is off on this phone, but its key couldn’t be removed from Supabase (${gone.error.message}). It’s removed next time you turn sync on or off.`
    : "Background sync is off. Gym Log syncs when you open it.";
}

export const runBackgroundNow = (): Promise<void> => GymSync.runNow();

/** On sign-in: background sync left on by another account stops here. (Its key stays unused in that account.) */
export async function checkBackgroundOwner(store: GymStore): Promise<void> {
  const owner = lsGet<string | null>(OWNER_KEY, null);
  if (!store.user || !owner || owner === store.user.id || !(await GymSync.status()).on) return;
  await GymSync.disable();
  lsSet(OWNER_KEY, null);
}
