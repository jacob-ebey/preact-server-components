import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/vite.ts"],
	dts: true,
	format: ["esm"],
	platform: "node",
});
