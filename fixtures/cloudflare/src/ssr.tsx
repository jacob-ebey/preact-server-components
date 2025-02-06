import type { ComponentType, VNode } from "preact";
import { lazy, Suspense } from "preact/compat";
import { renderToStringAsync } from "preact-render-to-string";

import {
	decode,
	type DecodeServerReferenceFunction,
	type DecodeClientReferenceFunction,
} from "preact-server-components";
import {
	assets,
	loadClientReference,
	// @ts-expect-error - no types
} from "virtual:preact-server-components/client";

import type { EncodedClientReference } from "./server";

export async function prerender(payloadStream: ReadableStream<string>) {
	const [payloadStreamA, payloadStreamB] = payloadStream.tee();
	const [payload, inlinePayload] = await Promise.all([
		decode<VNode>(payloadStreamA, {
			decodeClientReference,
			decodeServerReference,
		}),
		readToText(payloadStreamB),
	]);

	const rendered = await renderToStringAsync(
		<html lang="en">
			<head>
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<meta name="color-scheme" content="light dark" />
				<link rel="icon" type="image/svg+xml" href="/vite.svg" />
			</head>

			<body>
				<div id="app">
					<Suspense fallback={null}>{payload}</Suspense>
				</div>
				{assets.map((asset: string) => (
					<script key={asset} type="module" src={asset} />
				))}
				<script
					dangerouslySetInnerHTML={{
						__html: `window.PREACT_STREAM = new ReadableStream({ start(c) { c.enqueue(${escapeHtml(JSON.stringify(inlinePayload))}); c.close(); } });`,
					}}
				/>
			</body>
		</html>,
	);

	return rendered;
}

const cache = new Map<string, ComponentType>();

const decodeClientReference: DecodeClientReferenceFunction<
	EncodedClientReference
> = (encoded) => {
	const key = `${encoded[0]}:${encoded[1]}`;
	const cached = cache.get(key);
	if (cached) {
		return cached;
	}
	const Comp = lazy(() =>
		loadClientReference(encoded).then((Component: any) => ({
			default: Component,
		})),
	) as ComponentType;
	cache.set(key, Comp);
	return Comp;
};

const decodeServerReference: DecodeServerReferenceFunction = () => {
	return () => {
		throw new Error("Server references are not supported during prerendering");
	};
};

async function readToText(stream: ReadableStream<string>) {
	let result = "";
	let reader = stream.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			result += value;
		}
		return result;
	} finally {
		reader.releaseLock();
	}
}

// This escapeHtml utility is based on https://github.com/zertosh/htmlescape
// License: https://github.com/zertosh/htmlescape/blob/0527ca7156a524d256101bb310a9f970f63078ad/LICENSE

// We've chosen to inline the utility here to reduce the number of npm dependencies we have,
// slightly decrease the code size compared the original package and make it esm compatible.

const ESCAPE_LOOKUP: { [match: string]: string } = {
	"&": "\\u0026",
	">": "\\u003e",
	"<": "\\u003c",
	"\u2028": "\\u2028",
	"\u2029": "\\u2029",
};

const ESCAPE_REGEX = /[&><\u2028\u2029]/g;

function escapeHtml(html: string) {
	return html.replace(ESCAPE_REGEX, (match) => ESCAPE_LOOKUP[match]);
}
