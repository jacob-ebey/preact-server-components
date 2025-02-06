import { cloudflare } from "@cloudflare/vite-plugin";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { createRunnableDevEnvironment, defineConfig } from "vite";
import preactServerComponents from "vite-preact-server-components";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	assetsInclude: ["**/*.html"],
	environments: {
		client: {
			build: {
				outDir: "dist/client",
				rollupOptions: {
					input: "src/browser.tsx",
				},
			},
		},
		ssr: {
			consumer: "server",
			build: {
				outDir: "dist/ssr",
			},
		},
		server: {
			consumer: "server",
			build: {
				outDir: "dist/server",
			},
			dev: {
				createEnvironment: (name, config) =>
					createRunnableDevEnvironment(name, config),
			},
		},
	},
	plugins: [
		cloudflare({
			configPath: "wrangler.ssr.toml",
			viteEnvironment: { name: "ssr" },
			auxiliaryWorkers: [
				{
					configPath: "wrangler.server.toml",
					viteEnvironment: { name: "server" },
				},
			],
		}),
		tsconfigPaths(),
		tailwindcss(),
		preact(),
		preactServerComponents({
			environments: {
				client: "client",
				server: ["server"],
				ssr: ["ssr"],
			},
		}),
	],
});
