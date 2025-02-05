import type { ComponentType } from "preact";
import type { EncodedClientReference } from "preact-server-components";

declare module "virtual:preact-server-components/client" {
	export function loadClientReference(
		reference: EncodedClientReference,
	): Promise<ComponentType<any>>;
}

declare module "virtual:preact-server-components/server" {
	export function loadServerReference(referenceId: string): Promise<unknown>;
}
