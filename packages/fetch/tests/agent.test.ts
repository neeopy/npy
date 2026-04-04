import { afterAll, describe, expect, test } from "bun:test";
import { createAgent } from "../src/agent";
import { AutoDialer } from "../src/dialers";
import {
    AgentBusyError,
    OriginMismatchError,
    RequestAbortedError,
    ResponseDecodeError,
} from "../src/errors";
import { createTestServer } from "./test-utils";

describe("agent.ts", () => {
    const testServer = createTestServer();
    const dialer = new AutoDialer();

    afterAll(async () => {
        await testServer.stop();
    });

    test("agent performs sequential requests against the same origin", async () => {
        const agent = createAgent(dialer, testServer.baseUrl);

        try {
            const response1 = await agent.send({
                url: `${testServer.baseUrl}/text`,
                method: "GET",
            });
            expect(response1.status).toBe(200);
            expect(await response1.text()).toBe("Hello, World!");

            const response2 = await agent.send({
                url: `${testServer.baseUrl}/json`,
                method: "GET",
            });
            expect(response2.status).toBe(200);
            expect(await response2.json()).toEqual({
                message: "Hello, JSON!",
            });

            expect(agent.isIdle).toBe(true);
        } finally {
            agent.close();
        }
    });

    test("agent rejects cross-origin requests with OriginMismatchError", async () => {
        const agent = createAgent(dialer, testServer.baseUrl);

        try {
            await expect(
                agent.send({
                    url: "http://example.com/test",
                    method: "GET",
                }),
            ).rejects.toBeInstanceOf(OriginMismatchError);
        } finally {
            agent.close();
        }
    });

    test("agent rejects concurrent use while busy with AgentBusyError", async () => {
        const agent = createAgent(dialer, testServer.baseUrl);

        try {
            const slowRequest = agent.send({
                url: `${testServer.baseUrl}/slow`,
                method: "GET",
            });

            await expect(
                agent.send({
                    url: `${testServer.baseUrl}/text`,
                    method: "GET",
                }),
            ).rejects.toBeInstanceOf(AgentBusyError);

            const response = await slowRequest;
            expect(await response.text()).toBe("Finally!");
            expect(agent.isIdle).toBe(true);
        } finally {
            agent.close();
        }
    });

    test("agent returns to idle after aborted requests", async () => {
        const agent = createAgent(dialer, testServer.baseUrl);

        try {
            const controller = new AbortController();
            const request = agent.send({
                url: `${testServer.baseUrl}/slow`,
                method: "GET",
                signal: controller.signal,
            });

            setTimeout(() => controller.abort(new Error("abort test")), 50);

            await expect(request).rejects.toBeInstanceOf(RequestAbortedError);
            await expect(agent.whenIdle()).resolves.toBeUndefined();
            expect(agent.isIdle).toBe(true);
        } finally {
            agent.close();
        }
    });

    test("agent maps decoding failures during body consumption", async () => {
        const agent = createAgent(dialer, testServer.baseUrl);

        try {
            const response = await agent.send({
                url: `${testServer.baseUrl}/bad-gzip`,
                method: "GET",
            });

            await expect(response.text()).rejects.toBeInstanceOf(
                ResponseDecodeError,
            );
        } finally {
            agent.close();
        }
    });

    test("agent metadata reflects host and port", () => {
        const agent = createAgent(dialer, testServer.baseUrl);

        try {
            const baseUrl = new URL(testServer.baseUrl);
            expect(agent.hostname).toBe(baseUrl.hostname);
            expect(agent.port).toBe(Number(baseUrl.port));
        } finally {
            agent.close();
        }
    });
});
