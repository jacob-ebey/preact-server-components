import { prerender } from "../src/ssr";

type Env = {
	SERVER: Fetcher;
};

export default {
	async fetch(request, env) {
		try {
			const url = new URL(request.url);

			const serverURL = new URL(request.url);
			serverURL.pathname = serverURL.pathname.replace(/\.data$/, "");

			const serverResponsePromise = env.SERVER.fetch(
				new Request(serverURL, {
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

			if (
				url.pathname.endsWith(".data") ||
				(request.headers.get("psc-action") &&
					request.method === "POST" &&
					request.body)
			) {
				return serverResponsePromise;
			}

			const serverResponse = await serverResponsePromise;
			if (!serverResponse.body) throw new Error("No body.");
			const body = await prerender(
				serverResponse.body.pipeThrough(new TextDecoderStream()),
			);

			const headers = new Headers(serverResponse.headers);
			headers.set("content-type", "text/html");
			return new Response(body, {
				headers,
				status: serverResponse.status,
			});
		} catch (error) {
			console.error(error);
			return new Response("Internal server error", {
				status: 500,
			});
		}
	},
} satisfies ExportedHandler<Env>;
