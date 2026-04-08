import { unrefTimer } from "./_internal/event-loop";
import { createAgent } from "./agent";
import { AutoDialer } from "./dialers";
import { UnsupportedProtocolError } from "./errors";
import type { Agent, AgentPool } from "./types/agent";

const defaultMax = Number.MAX_SAFE_INTEGER;
const defaultIdleTimeout = 30_000;

interface IdleAgentEntry {
    agent: Agent;
    expiresAt: number;
}

interface PendingAcquire {
    resolve: (agent: Agent) => void;
    reject: (error: unknown) => void;
}

function defaultPort(protocol: string): number {
    return protocol === "https:" ? 443 : 80;
}

function createPoolClosedError(origin: string): Error {
    return new Error(`Agent pool is closed for ${origin}`);
}

export function createAgentPool(
    baseUrl: string,
    options: AgentPool.Options = {},
): AgentPool {
    const poolUrl = new URL(baseUrl);

    if (poolUrl.protocol !== "http:" && poolUrl.protocol !== "https:") {
        throw new UnsupportedProtocolError(poolUrl.protocol, {
            origin: poolUrl.origin,
            scheme: poolUrl.protocol,
            host: poolUrl.hostname,
            port: poolUrl.port ? Number.parseInt(poolUrl.port, 10) : undefined,
        });
    }

    const max = options.poolMaxPerHost
        ? Math.max(1, options.poolMaxPerHost)
        : defaultMax;

    const idleTimeout =
        options.poolIdleTimeout !== false
            ? Math.max(1, options.poolIdleTimeout || defaultIdleTimeout)
            : null;

    // Keep the historical external behavior:
    // poolMaxIdlePerHost only matters when idle eviction is enabled.
    const maxIdle =
        idleTimeout != null && options.poolMaxIdlePerHost != null
            ? Math.max(0, options.poolMaxIdlePerHost)
            : Number.MAX_SAFE_INTEGER;

    const dialer = options.dialer ?? new AutoDialer();
    const connectOptions = options.connect ?? {};
    const ioOptions = options.io;

    const idleAgents: IdleAgentEntry[] = [];
    const busyAgents = new Set<Agent>();
    const allAgents = new Set<Agent>();
    const pendingAcquires: PendingAcquire[] = [];

    let maintenanceTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let closePromise: Promise<void> | undefined;

    function createPoolAgent(): Agent {
        const agent = createAgent(dialer, baseUrl, {
            connect: connectOptions,
            io: ioOptions,
        });

        allAgents.add(agent);
        return agent;
    }

    function clearMaintenanceTimer(): void {
        if (maintenanceTimer === undefined) {
            return;
        }

        clearTimeout(maintenanceTimer);
        maintenanceTimer = undefined;
    }

    function removeIdleAgent(agent: Agent): void {
        for (let i = idleAgents.length - 1; i >= 0; i -= 1) {
            if (idleAgents[i]!.agent === agent) {
                idleAgents.splice(i, 1);
                break;
            }
        }
    }

    function closeAgent(agent: Agent): unknown | undefined {
        removeIdleAgent(agent);
        busyAgents.delete(agent);
        allAgents.delete(agent);

        try {
            agent.close();
            return undefined;
        } catch (error) {
            return error;
        }
    }

    function destroyAgent(agent: Agent): void {
        // Non-explicit cleanup must remain conservative and non-throwing.
        closeAgent(agent);
    }

    function rejectPendingAcquires(error: unknown): void {
        while (pendingAcquires.length > 0) {
            pendingAcquires.shift()!.reject(error);
        }
    }

    function pruneExpiredIdleAgents(now: number = Date.now()): void {
        if (idleTimeout == null || idleAgents.length === 0) {
            return;
        }

        const expired: Agent[] = [];

        for (let i = idleAgents.length - 1; i >= 0; i -= 1) {
            const entry = idleAgents[i]!;
            if (entry.expiresAt <= now) {
                idleAgents.splice(i, 1);
                expired.push(entry.agent);
            }
        }

        for (const agent of expired) {
            destroyAgent(agent);
        }
    }

    function scheduleMaintenance(): void {
        clearMaintenanceTimer();

        if (closed || idleTimeout == null || idleAgents.length === 0) {
            return;
        }

        let nextExpiresAt = Number.POSITIVE_INFINITY;
        for (const entry of idleAgents) {
            if (entry.expiresAt < nextExpiresAt) {
                nextExpiresAt = entry.expiresAt;
            }
        }

        if (!Number.isFinite(nextExpiresAt)) {
            return;
        }

        const delay = Math.max(1, nextExpiresAt - Date.now());

        maintenanceTimer = setTimeout(() => {
            maintenanceTimer = undefined;
            pruneExpiredIdleAgents();
            scheduleMaintenance();
        }, delay);

        // Idle eviction is purely maintenance and must never keep the loop alive.
        unrefTimer(maintenanceTimer);
    }

    function assertOpen(): void {
        if (closed) {
            throw createPoolClosedError(poolUrl.origin);
        }
    }

    function releaseAgent(agent: Agent, forceClose = false): void {
        if (!allAgents.has(agent)) {
            return;
        }

        busyAgents.delete(agent);
        removeIdleAgent(agent);

        if (forceClose || closed) {
            destroyAgent(agent);
            return;
        }

        const waiter = pendingAcquires.shift();
        if (waiter) {
            busyAgents.add(agent);
            waiter.resolve(agent);
            return;
        }

        if (idleAgents.length >= maxIdle) {
            destroyAgent(agent);
            return;
        }

        idleAgents.push({
            agent,
            expiresAt:
                idleTimeout == null
                    ? Number.POSITIVE_INFINITY
                    : Date.now() + idleTimeout,
        });

        scheduleMaintenance();
    }

    async function acquireAgent(): Promise<Agent> {
        assertOpen();

        pruneExpiredIdleAgents();

        const idleEntry = idleAgents.pop();
        if (idleEntry) {
            busyAgents.add(idleEntry.agent);
            scheduleMaintenance();
            return idleEntry.agent;
        }

        if (allAgents.size < max) {
            const agent = createPoolAgent();
            busyAgents.add(agent);
            return agent;
        }

        return new Promise<Agent>((resolve, reject) => {
            pendingAcquires.push({ resolve, reject });
        });
    }

    async function send(sendOptions: Agent.SendOptions): Promise<Response> {
        const agent = await acquireAgent();
        let released = false;

        const release = (forceClose = false): void => {
            if (released) {
                return;
            }

            released = true;
            releaseAgent(agent, forceClose);
        };

        try {
            // Start the request first.
            // This is critical: Agent.send() swaps the idle promise synchronously
            // before its first await, so whenIdle() must observe the *new* pending
            // cycle, not the previously resolved idle state.
            const responsePromise = agent.send(sendOptions);

            void agent.whenIdle().then(
                () => release(false),
                () => release(true),
            );

            return await responsePromise;
        } catch (error) {
            release(true);
            throw error;
        }
    }

    async function close(): Promise<void> {
        if (closePromise) {
            return closePromise;
        }

        if (closed) {
            return;
        }

        const promise = (async () => {
            closed = true;
            clearMaintenanceTimer();

            rejectPendingAcquires(createPoolClosedError(poolUrl.origin));

            const agents = Array.from(allAgents);
            idleAgents.length = 0;
            busyAgents.clear();
            allAgents.clear();

            const errors: unknown[] = [];

            for (const agent of agents) {
                const error = closeAgent(agent);
                if (error !== undefined) {
                    errors.push(error);
                }
            }

            if (errors.length === 1) {
                throw errors[0];
            }

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
            if (closePromise === promise) {
                closePromise = undefined;
            }
        }
    }

    return {
        [Symbol.asyncDispose]: close,
        close,
        hostname: poolUrl.hostname,
        port: poolUrl.port
            ? Number.parseInt(poolUrl.port, 10)
            : defaultPort(poolUrl.protocol),
        send,
    };
}
