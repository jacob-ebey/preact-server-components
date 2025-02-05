import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/preact-server-components.ts"],
	dts: true,
	format: ["esm"],
	platform: "neutral",
});
