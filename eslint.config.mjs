import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // android/ holds the native app and a copy of out/ (see capacitor.config.ts).
  globalIgnores([".next/**", "out/**", "android/**", "next-env.d.ts"]),
]);
