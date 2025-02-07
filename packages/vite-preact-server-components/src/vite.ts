import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import * as lexer from "es-module-lexer";
import * as vite from "vite";

const jsModuleExtensions = [".js", ".mjs", ".jsx", ".ts", ".mts", ".tsx"];

export type PreactServerComponentsOptions = {
	environments: {
		client: string;
		server: string[];
		ssr?: string[];
	};
	massageClientModuleId?: (root: string, id: string) => string;
};

export default function preactServerComponents({
	environments,
	massageClientModuleId,
}: PreactServerComponentsOptions): vite.Plugin {
	if (!environments.client) {
		environments.client = "client";
	}

	const serverEnvironments = new Set(environments.server);
	const ssrEnvironments = new Set(environments.ssr);
	const allEnvironments = new Set([
		environments.client,
		...serverEnvironments,
		...ssrEnvironments,
	]);
	const serverishEnvironments = [...serverEnvironments, ...ssrEnvironments];

	if (
		allEnvironments.size !==
		1 + serverEnvironments.size + ssrEnvironments.size
	) {
		throw new Error(
			"Duplicate environment names found beetween client, server and ssr environments",
		);
	}

	let building = false;
	let scanning = false;
	let manifest: PromiseWithResolvers<
		Record<
			string,
			{
				file: string;
				imports: string[];
			}
		>
	> = Promise.withResolvers();

	const foundModules = {
		client: new Map<string, string>(),
		server: new Map<string, string>(),
	};

	let clientEntries: string[] = [];
	const bundles = new Map<string, vite.Rollup.OutputBundle>();

	return {
		name: "preact-server-components",
		configEnvironment(name, config) {
			if (name === environments.client) {
				clientEntries = rollupInputsToArray(
					config.build?.rollupOptions?.input,
				).map((p) => vite.normalizePath(path.resolve(p)));
			}

			if (allEnvironments.has(name)) {
				return vite.mergeConfig<
					vite.EnvironmentOptions,
					vite.EnvironmentOptions
				>(
					{
						build: {
							emitAssets: true,
							manifest: name === environments.client,
							ssrManifest:
								serverEnvironments.has(name) || ssrEnvironments.has(name),
							rollupOptions: {
								preserveEntrySignatures: "exports-only",
							},
						},
						resolve: {
							dedupe: ["preact"],
						},
					},
					config,
				);
			}
		},
		config(config) {
			return vite.mergeConfig<vite.UserConfig, vite.UserConfig>(
				config,
				{
					builder: {
						sharedConfigBuild: true,
						sharedPlugins: true,
						async buildApp(builder) {
							console.log("scanning dependency graph...");
							scanning = true;

							try {
								if (config.builder?.buildApp) {
									await config.builder.buildApp(builder);
								} else {
									await Promise.all(
										Array.from(allEnvironments).map((name) =>
											builder.build(builder.environments[name]),
										),
									);
								}
							} finally {
								scanning = false;
							}

							console.log("scanning complete");
							building = true;
							manifest = Promise.withResolvers();

							try {
								builder.environments[
									environments.client
								].config.build.rollupOptions.input = mergeRollupInputs(
									builder.environments[environments.client].config.build
										.rollupOptions.input,
									Array.from(foundModules.client.keys()),
								);

								if (config.builder?.buildApp) {
									await config.builder.buildApp(builder);
								} else {
									await builder.build(
										builder.environments[environments.client],
									);

									await Promise.all(
										serverishEnvironments.map((name) =>
											builder.build(builder.environments[name]),
										),
									);
								}

								console.log("moving static assets...");

								for (let name of serverEnvironments) {
									const outdir = builder.environments[name].config.build.outDir;
									const bundle = bundles.get(name);
									if (!bundle) {
										throw new Error(`No bundle found for ${name}`);
									}
									moveStaticAssets(
										bundle,
										builder.environments.ssr.config.build.outDir,
										outdir,
									);
								}
							} finally {
								building = false;
							}
						},
					},
				},
				true,
			);
		},
		writeBundle(_, bundle) {
			bundles.set(this.environment.name, bundle);
			if (this.environment.name === environments.client) {
				const asset = bundle[".vite/manifest.json"];
				if (!asset || asset.type !== "asset" || !asset.source) {
					throw new Error("could not find manifest");
				}
				manifest.resolve(
					JSON.parse(
						typeof asset.source === "string"
							? asset.source
							: new TextDecoder().decode(asset.source),
					),
				);
			}
		},
		resolveId(id) {
			if (id === "virtual:preact-server-components/client") {
				return "\0virtual:preact-server-components/client";
			}
			if (id === "virtual:preact-server-components/server") {
				return "\0virtual:preact-server-components/server";
			}
		},
		async load(id) {
			if (id === "\0virtual:preact-server-components/client") {
				if (
					environments.client !== this.environment.name &&
					!ssrEnvironments.has(this.environment.name)
				) {
					throw new Error(
						"Cannot load client references outside of client or ssr environments",
					);
				}
				if (this.environment.mode !== "dev") {
					if (this.environment.name !== environments.client) {
						let assets = "";
						if (ssrEnvironments.has(this.environment.name)) {
							assets = `export const assets = ${JSON.stringify(
								Array.from(
									new Set(
										(
											await Promise.all(
												Array.from(new Set(clientEntries)).map(async (input) =>
													collectChunks(
														this.environment.config.base,
														massageClientModuleId
															? massageClientModuleId(
																	this.environment.config.root,
																	input,
																)
															: path.relative(
																	this.environment.config.root,
																	input,
																),
														await manifest.promise,
													),
												),
											)
										).flat(),
									),
								),
							)}`;
						}
						return `
							${assets}
                            const clientModules = {
                            ${(
															await Promise.all(
																Array.from(foundModules.client.keys()).map(
																	async (filename) => {
																		const found = building
																			? findClientModule(
																					massageClientModuleId
																						? massageClientModuleId(
																								this.environment.config.root,
																								filename,
																							)
																						: path.relative(
																								this.environment.config.root,
																								filename,
																							),
																					await manifest.promise,
																					this.environment.config.base,
																				)
																			: null;
																		if (building && !found) {
																			throw new Error(
																				`Could not find client module for ${filename}`,
																			);
																		}
																		return `${JSON.stringify(
																			found?.id,
																		)}: () => import(${JSON.stringify(filename)}),`;
																	},
																),
															)
														).join("  \n")}
                            };

                            export async function loadClientReference([id, name, ...chunks]) {
                                const mod = await clientModules[id]();
                                return mod[name];
                            }
                        `;
					}

					return `
                        export async function loadClientReference([id, name, ...chunks]) {
                            const importPromise = import(/* @vite-ignore */ id);
                            for (const chunk of chunks) {
                                import(/* @vite-ignore */ chunk).catch(() => {});
							}
                            const mod = await importPromise;
                            return mod[name];
                        }
						`;
				}

				let assets = "";
				if (ssrEnvironments.has(this.environment.name)) {
					assets = `export const assets = ${JSON.stringify(clientEntries)}`;
				}

				return `
					${assets}
                    export async function loadClientReference([id, name]) {
                        const mod = await import(/* @vite-ignore */ id);
                        return mod[name];
                    }
                `;
			}

			if (id === "\0virtual:preact-server-components/server") {
				if (!serverEnvironments.has(this.environment.name)) {
					throw new Error(
						"Cannot load server references outside of server environments",
					);
				}
				if (this.environment.mode !== "dev") {
					return `
                        const serverModules = {
                            ${Array.from(foundModules.server.entries())
															.map(([filename, id]) => {
																return `${JSON.stringify(
																	id,
																)}: () => import(${JSON.stringify(filename)}),`;
															})
															.join("  \n")}
                        };
                        
                        export async function loadServerReference(id) {
                            const [modId, ...rest] = id.split("#");
                            const mod = await serverModules[modId]();
                            return mod[rest.join("#")];
                        }
                    `;
				}

				return `
                    export async function loadServerReference(id) {
                        const [modId, ...rest] = id.split("#");
                        const mod = await import(/* @vite-ignore */ modId);
                        return mod[rest.join("#")];
                    }
                `;
			}
		},
		async transform(code, id) {
			if (!isJavaScriptModule(id)) return;

			const directiveMatch = code.match(/['"]use (client|server)['"]/);

			const hash = crypto
				.createHash("sha256")
				.update(id)
				.digest("hex")
				.slice(0, 8);
			if (scanning) {
				if (directiveMatch) {
					const useFor = directiveMatch[1] as "client" | "server";
					foundModules[useFor].set(id, hash);
				}

				const [imports, exports] = lexer.parse(code, id);
				// Return a new module retaining the import statements
				// and replacing exports with null exports
				const newImports = imports
					.map((imp) => `import ${JSON.stringify(imp.n)};`)
					.join("\n");
				const newExports = exports
					.map((exp) =>
						exp.n === "default"
							? "export default null;"
							: `export let ${exp.n} = null;`,
					)
					.join("\n");
				return `${newImports}\n${newExports}`;
			}

			if (!directiveMatch) return;
			const useFor = directiveMatch[1] as "client" | "server";

			const [, exports] = lexer.parse(code, id);
			const mod =
				building && serverEnvironments.has(this.environment.name)
					? findClientModule(
							massageClientModuleId
								? massageClientModuleId(this.environment.config.root, id)
								: path.relative(this.environment.config.root, id),
							await manifest.promise,
							this.environment.config.base,
						)
					: null;
			let referenceId: string = mod
				? mod.id.startsWith("/")
					? mod.id
					: "/" + mod.id
				: vite.normalizePath(id);

			let chunks: string[] = mod ? mod.chunks : [];

			if (useFor === "client") {
				if (serverEnvironments.has(this.environment.name)) {
					const newExports = exports
						.map((exp) =>
							exp.n === "default"
								? `export default { $$typeof: CLIENT_REFERENCE, $$id: ${JSON.stringify(referenceId)}, $$name: ${JSON.stringify(exp.n)}, $$chunks: ${JSON.stringify(chunks)} };`
								: `export const ${exp.n} = { $$typeof: CLIENT_REFERENCE, $$id: ${JSON.stringify(referenceId)}, $$name: ${JSON.stringify(exp.n)}, $$chunks: ${JSON.stringify(chunks)} };`,
						)
						.join("\n");

					return `const CLIENT_REFERENCE = Symbol.for("preact.client.reference");\n${newExports}`;
				}
			} else if (useFor === "server") {
				referenceId =
					this.environment.mode === "dev"
						? referenceId
						: (foundModules.server.get(id) as string);
				if (!referenceId) {
					throw new Error(`Could not find server reference ID for ${id}`);
				}
				if (serverEnvironments.has(this.environment.name)) {
					const markExports = exports
						.map((exp) =>
							exp.n === "default"
								? "// default export not supported as server reference"
								: `if (typeof ${exp.n} === "function") { ${exp.n}.$$typeof = SERVER_REFERENCE; ${exp.n}.$$id = ${JSON.stringify(referenceId)}; ${exp.n}.$$name = ${JSON.stringify(exp.n)}; }`,
						)
						.join("\n");

					return `${code}\nconst SERVER_REFERENCE = Symbol.for("preact.server.reference");\n${markExports}`;
				}

				const newExports = exports
					.map((exp) =>
						exp.n === "default"
							? `export default { $$typeof: SERVER_REFERENCE, $$id: ${JSON.stringify(referenceId)}, $$name: ${JSON.stringify(exp.n)} };`
							: `export const ${exp.n} = { $$typeof: SERVER_REFERENCE, $$id: ${JSON.stringify(referenceId)}, $$name: ${JSON.stringify(exp.n)} };`,
					)
					.join("\n");

				return `const SERVER_REFERENCE = Symbol.for("preact.server.reference");\n${newExports}`;
			}
		},
	};
}

function isJavaScriptModule(id: string) {
	return jsModuleExtensions.some((ext) => id.endsWith(ext));
}

function mergeRollupInputs(
	inputs: vite.Rollup.InputOption | undefined,
	extra: string[],
) {
	return Array.from(new Set([...rollupInputsToArray(inputs), ...extra]));
}

function rollupInputsToArray(
	rollupInputs: vite.Rollup.InputOption | undefined,
) {
	return Array.isArray(rollupInputs)
		? rollupInputs
		: typeof rollupInputs === "string"
			? [rollupInputs]
			: rollupInputs
				? Object.values(rollupInputs)
				: [];
}

function moveStaticAssets(
	output: vite.Rollup.OutputBundle,
	outDir: string,
	clientOutDir: string,
) {
	const manifestAsset = Object.values(output).find(
		(asset) => asset.fileName === ".vite/ssr-manifest.json",
	);
	if (!manifestAsset || manifestAsset.type !== "asset")
		throw new Error("could not find manifest");
	const manifest = JSON.parse(manifestAsset.source as string);

	const processed = new Set<string>();
	for (const assets of Object.values(manifest) as string[][]) {
		for (const asset of assets) {
			const fullPath = path.join(outDir, asset.slice(1));

			if (asset.endsWith(".js") || processed.has(fullPath)) continue;
			processed.add(fullPath);

			if (!fs.existsSync(fullPath)) continue;

			const relative = path.relative(outDir, fullPath);
			fs.renameSync(fullPath, path.join(clientOutDir, relative));
		}
	}
}

function findClientModule(
	forFilename: string,
	manifest: Record<string, { file: string; imports: string[] }>,
	base: string,
) {
	const collected = collectChunks(base, forFilename, manifest);
	if (collected.length === 0) {
		return null;
	}

	return {
		id: collected[0],
		chunks: collected.slice(1),
	};
}

function collectChunks(
	base: string,
	forFilename: string,
	manifest: Record<string, { file: string; imports: string[] }>,
	collected: Set<string> = new Set(),
) {
	if (manifest[forFilename]) {
		collected.add(base + manifest[forFilename].file);
		for (const imp of manifest[forFilename].imports ?? []) {
			collectChunks(base, imp, manifest, collected);
		}
	}

	return Array.from(collected);
}
