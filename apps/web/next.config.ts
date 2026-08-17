import type { NextConfig } from "next";

const config: NextConfig = {
  // @dropcheck/shared is consumed as raw TypeScript source (no build
  // step, so there's no dist/ to drift from the API's copy). Next has to
  // be told to run it through its compiler like first-party code.
  transpilePackages: ["@dropcheck/shared"],
};

export default config;
