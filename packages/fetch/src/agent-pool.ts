import { createPool } from "generic-pool";
import { createAgent } from "./agent";
import { AutoDialer } from "./dialers";
import { UnsupportedProtocolError } from "./errors";
import type { Agent, AgentPool } from "./types/agent";

const defaultEvictionInterval = 10_000;
const defaultMax = Number.MAX_SAFE_INTEGER;
const defaultIdleTimeout = 30_000;

export function createAgentPool(
    baseUrl: string,
    options: AgentPool.Options = {},
): AgentPool {
    const poolUrl = new URL(baseUrl);

    const evictionRunIntervalMillis =
        options.poolIdleTimeout !== false
            ? Math.min(
                  options.poolIdleTimeout || defaultEvictionInterval,
                  defaultEvictionInterval,
              )
            : 0;
    const max = options.poolMaxPerHost
        ? Math.max(1, options.poolMaxPerHost)
        : defaultMax;
    const softIdleTimeoutMillis =
        options.poolIdleTimeout !== false
            ? Math.max(1, options.poolIdleTimeout || defaultIdleTimeout)
            : -1;
    const min =
        softIdleTimeoutMillis > 0 && options.poolMaxIdlePerHost
            ? Math.max(0, options.poolMaxIdlePerHost)
            : 0;

    if (poolUrl.protocol !== "http:" && poolUrl.protocol !== "https:") {
        throw new UnsupportedProtocolError(poolUrl.protocol, {
            origin: poolUrl.origin,
            scheme: poolUrl.protocol,
            host: poolUrl.hostname,
            port: poolUrl.port ? Number.parseInt(poolUrl.port, 10) : undefined,
        });
    }

    const dialer = options.dialer ?? new AutoDialer();
    const connectOptions = options.connect ?? {};
    const ioOptions = options.io;

    const pool = createPool<Agent>(
        {
            async create() {
                return createAgent(dialer, baseUrl, {
                    connect: connectOptions,
                    io: ioOptions,
                });
            },
            async destroy(agent) {
                agent.close();
            },
        },
        {
            autostart: false,
            evictionRunIntervalMillis,
            softIdleTimeoutMillis,
            max,
            min,
        },
    );

    let releaseAgentFns: Array<(forceClose?: boolean) => Promise<void>> = [];
    let closePromise: Promise<void> | undefined;

    async function send(sendOptions: Agent.SendOptions): Promise<Response> {
        let agent: Agent | undefined;
        let agentReleased = false;

        const releaseAgentFn = async (forceClose = false) => {
            if (!agent || agentReleased) return;
            agentReleased = true;
            releaseAgentFns = releaseAgentFns.filter(
                (release) => release !== releaseAgentFn,
            );
            if (forceClose) agent.close();
            if (pool.isBorrowedResource(agent)) await pool.release(agent);
        };

        releaseAgentFns.push(releaseAgentFn);

        try {
            agent = await pool.acquire();
            const responsePromise = agent.send(sendOptions);

            void agent.whenIdle().then(
                () => releaseAgentFn(),
                () => releaseAgentFn(true),
            );

            return responsePromise;
        } catch (error) {
            await releaseAgentFn(true);
            throw error;
        }
    }

    async function close(): Promise<void> {
        if (closePromise) return closePromise;

        const promise = (async () => {
            const pendingReleases = releaseAgentFns;
            releaseAgentFns = [];

            const results = await Promise.allSettled([
                ...pendingReleases.map((release) => release(true)),
                (async () => {
                    try {
                        await pool.drain();
                    } finally {
                        await pool.clear();
                    }
                })(),
            ]);

            const errors = results.flatMap((result) =>
                result.status === "rejected" ? [result.reason] : [],
            );

            if (errors.length === 1) throw errors[0];

            if (errors.length > 1) {
                throw new AggregateError(
                    errors,
                    "Failed to close agent pool cleanly",
                );
            }
        })();

        closePromise = promise;

        try {
            await promise;
        } finally {
            if (closePromise === promise) closePromise = undefined;
        }
    }

    return {
        [Symbol.asyncDispose]: close,
        close,
        hostname: poolUrl.hostname,
        port: poolUrl.port
            ? Number.parseInt(poolUrl.port, 10)
            : poolUrl.protocol === "https:"
              ? 443
              : 80,
        send,
    };
}
