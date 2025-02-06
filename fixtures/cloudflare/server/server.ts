import { handleRequest } from "../src/server";

export default {
	async fetch(request, env) {
		return handleRequest(request);
	},
} satisfies ExportedHandler;
