import type { CapacitorConfig } from "@capacitor/cli";

// The Android app: the same static build (out/) inside a native shell, so it can read Health Connect.
// `npm run android` builds the site and copies it into android/; see README.md.
const config: CapacitorConfig = {
  appId: "io.github.raja2102598.gymlog",
  appName: "Gym Log",
  webDir: "out",
};

export default config;
