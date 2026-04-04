import { createAgentPool } from "./agent-pool";
import type { Agent, AgentPool } from "./types/agent";

/**
 * Advanced HTTP client with per-origin pooling and explicit lifecycle control.
 *
 * @remarks
 * Use this API when you want direct access to the library's richer error model and
 * transport options instead of the fetch-like compatibility layer.
 *
 *
 * @example
 * ```ts
 * const client = new HttpClient();
 * const response = await client.send({
 *   url: "https://httpbin.org/anything",
 *   method: "GET",
 * });
 * await client.close();
 * ```
 */
export class HttpClient implements AsyncDisposable {
    readonly #agentPools = new Map<string, AgentPool>();
    readonly #agentPoolOptions: Readonly<HttpClient.Options>;
    #closePromise?: Promise<void>;

    constructor(options: HttpClient.Options = {}) {
        this.#agentPoolOptions = { ...options };
    }

    get options(): Readonly<HttpClient.Options> {
        return this.#agentPoolOptions;
    }

    async send(options: Agent.SendOptions): Promise<Response> {
        const agentPool = this.#getOrCreateAgentPool(options.url);
        return agentPool.send(options);
    }

    /**
     * Closes all pooled connections owned by this client.
     *
     * @remarks
     * After closing, future requests may recreate pools as needed.
     */
    async close(): Promise<void> {
        if (this.#closePromise) {
            return this.#closePromise;
        }

        const promise = (async () => {
            const entries = Array.from(this.#agentPools.entries());

            const results = await Promise.allSettled(
                entries.map(async ([origin, agentPool]) => {
                    try {
                        await agentPool.close();
                    } finally {
                        this.#agentPools.delete(origin);
                    }
                }),
            );

            const errors = results.flatMap((result) =>
                result.status === "rejected" ? [result.reason] : [],
            );

            if (errors.length === 1) throw errors[0];

            if (errors.length > 1) {
                throw new AggregateError(
                    errors,
                    "Failed to close one or more agent pools",
                );
            }
        })();

        this.#closePromise = promise;

        try {
            await promise;
        } finally {
            if (this.#closePromise === promise) {
                this.#closePromise = undefined;
            }
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
    export interface Options extends AgentPool.Options {}
}

export interface HttpClientOptions extends HttpClient.Options {}
