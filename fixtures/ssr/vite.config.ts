import { createRequestListener } from "@mjackson/node-fetch-server";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import {
	createRunnableDevEnvironment,
	defineConfig,
	type RunnableDevEnvironment,
} from "vite";
import mkcert from "vite-plugin-mkcert";
import preactServerComponents from "vite-preact-server-components";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	server: {},
	environments: {
		client: {
			build: {
				outDir: "dist/client",
				rollupOptions: {
					input: ["index.html"],
				},
			},
		},
		ssr: {
			consumer: "server",
			build: {
				outDir: "dist/ssr",
				rollupOptions: {
					input: "src/ssr.tsx",
				},
			},
			resolve: {
				noExternal: true,
			},
		},
		server: {
			consumer: "server",
			build: {
				outDir: "dist/server",
				rollupOptions: {
					input: "src/server.tsx",
				},
			},
			dev: {
				createEnvironment: (name, config) =>
					createRunnableDevEnvironment(name, config),
			},
			resolve: {
				noExternal: true,
			},
		},
	},
	plugins: [
		mkcert(),
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
		{
			name: "dev-server",
			configureServer(server) {
				const serverEnv = server.environments.server as RunnableDevEnvironment;

				const listener = createRequestListener(async (request) => {
					const serverMod =
						await serverEnv.runner.import<typeof import("./src/server")>(
							"./src/server.tsx",
						);

					const url = new URL(request.url);
					url.pathname = url.pathname.replace(/\.data$/, "");

					return serverMod.handleRequest(
						new Request(url, {
							body: request.body,
							duplex:
								request.method !== "GET" && request.method !== "HEAD"
									? "half"
									: undefined,
							headers: request.headers,
							method: request.method,
							signal: request.signal,
						} as RequestInit & { duplex?: "half" }),
					);
				});

				return () => {
					server.middlewares.use(async (req, res, next) => {
						const url = new URL(req.url ?? "/", "http://localhost");
						if (url.pathname.endsWith(".data") || req.headers["psc-action"]) {
							try {
								listener(req, res);
							} catch (error) {
								next(error);
							}
						} else {
							next();
						}
					});
				};
			},
		},
	],
});
