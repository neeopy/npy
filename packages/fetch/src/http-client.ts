import { createAgentPool } from "./agent-pool";
import type { AgentPool, AgentPoolOptions, SendOptions } from "./types/agent";

export class HttpClient implements AsyncDisposable {
    readonly #agentPools = new Map<string, AgentPool>();
    readonly #agentPoolOptions: Readonly<HttpClient.Options>;

    constructor(options: HttpClient.Options = {}) {
        this.#agentPoolOptions = { ...options };
    }

    async send(options: SendOptions): Promise<Response> {
        const agentPool = this.#getOrCreateAgentPool(options.url);
        return agentPool.send(options);
    }

    async close(): Promise<void> {
        const entries = Array.from(this.#agentPools.entries());

        const results = await Promise.allSettled(
            entries.map(([origin, agentPool]) =>
                agentPool.close().then(() => {
                    this.#agentPools.delete(origin);
                }),
            ),
        );

        const failed = results.find(
            (r): r is PromiseRejectedResult => r.status === "rejected",
        );

        if (failed) {
            throw failed.reason;
        }
    }

    async [Symbol.asyncDispose](): Promise<void> {
        await this.close();
    }

    #getOrCreateAgentPool(url: string | URL): AgentPool {
        const origin =
            typeof url === "string" ? new URL(url).origin : url.origin;

        let agentPool = this.#agentPools.get(origin);
        if (!agentPool) {
            agentPool = createAgentPool(origin, this.#agentPoolOptions);
            this.#agentPools.set(origin, agentPool);
        }

        return agentPool;
    }
}

export namespace HttpClient {
    /**
     * High-level client configuration.
     *
     * At this layer, the API exposes:
     * - pool management options
     * - socket connection options
     * - HTTP reader/writer options forwarded to the agent I/O layer
     */
    export interface Options extends AgentPoolOptions {}
}

/** Back-compat */
export interface HttpClientOptions extends HttpClient.Options {}
