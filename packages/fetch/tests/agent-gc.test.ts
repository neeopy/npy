import { afterAll, describe, expect, test } from "bun:test";
import {
    ManualResponseCollectionBackend,
    setResponseCollectionBackendForTesting,
} from "../src/_internal/response-gc";
import { createAgent } from "../src/agent";
import { AutoDialer } from "../src/dialers";
import { createTestServer, sleep } from "./test-utils";

async function flushResponseRelease(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await sleep(0);
    await Promise.resolve();
}

describe("agent GC-backed response cleanup", () => {
    const testServer = createTestServer();
    const dialer = new AutoDialer();

    afterAll(async () => {
        await testServer.stop();
    });

    test("simulated collection of an unread response releases the agent conservatively", async () => {
        const backend = new ManualResponseCollectionBackend();
        const restoreBackend = setResponseCollectionBackendForTesting(backend);
        const agent = createAgent(dialer, testServer.baseUrl);

        try {
            const response = await agent.send({
                url: `${testServer.baseUrl}/slow-body`,
                method: "GET",
            });

            expect(response.status).toBe(200);
            expect(agent.isIdle).toBe(false);
            expect(backend.size).toBe(1);

            const idlePromise = agent.whenIdle();
            expect(backend.collect(response)).toBe(true);

            await flushResponseRelease();
            await expect(idlePromise).resolves.toBeUndefined();

            expect(agent.isIdle).toBe(true);
            expect(backend.size).toBe(0);

            const followUp = await agent.send({
                url: `${testServer.baseUrl}/text`,
                method: "GET",
            });

            expect(await followUp.text()).toBe("Hello, World!");
        } finally {
            restoreBackend();
            agent.close();
        }
    });

    test("clone-aware cleanup waits until the final tracked clone is collected", async () => {
        const backend = new ManualResponseCollectionBackend();
        const restoreBackend = setResponseCollectionBackendForTesting(backend);
        const agent = createAgent(dialer, testServer.baseUrl);

        try {
            const response = await agent.send({
                url: `${testServer.baseUrl}/slow-body`,
                method: "GET",
            });
            const clone = response.clone();

            expect(response.status).toBe(200);
            expect(backend.size).toBe(2);

            const idlePromise = agent.whenIdle();
            let settled = false;

            void idlePromise.then(() => {
                settled = true;
            });

            expect(backend.collect(response)).toBe(true);
            await flushResponseRelease();

            expect(settled).toBe(false);
            expect(agent.isIdle).toBe(false);
            expect(backend.size).toBe(1);

            expect(backend.collect(clone)).toBe(true);
            await flushResponseRelease();

            expect(settled).toBe(true);
            await expect(idlePromise).resolves.toBeUndefined();
            expect(agent.isIdle).toBe(true);
            expect(backend.size).toBe(0);

            const followUp = await agent.send({
                url: `${testServer.baseUrl}/json`,
                method: "GET",
            });

            expect(await followUp.json()).toEqual({
                message: "Hello, JSON!",
            });
        } finally {
            restoreBackend();
            agent.close();
        }
    });

    test("repeated abandoned responses do not wedge the agent", async () => {
        const backend = new ManualResponseCollectionBackend();
        const restoreBackend = setResponseCollectionBackendForTesting(backend);
        const agent = createAgent(dialer, testServer.baseUrl);

        try {
            for (let i = 0; i < 25; i += 1) {
                const response = await agent.send({
                    url: `${testServer.baseUrl}/slow-body`,
                    method: "GET",
                });

                const idlePromise = agent.whenIdle();
                expect(backend.collect(response)).toBe(true);

                await flushResponseRelease();
                await expect(idlePromise).resolves.toBeUndefined();

                expect(agent.isIdle).toBe(true);
                expect(backend.size).toBe(0);
            }
        } finally {
            restoreBackend();
            agent.close();
        }
    });
});
