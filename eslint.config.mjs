import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    rules: {
      // This project intentionally uses effects for authenticated Firestore/API data loading.
      // Keep the React guidance visible without making every async hydration effect a CI blocker.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  globalIgnores([".next/**","out/**","build/**","next-env.d.ts"]),
]);
export default eslintConfig;
