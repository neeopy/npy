import { afterAll, describe, expect, test } from "bun:test";
import { createAgentPool } from "../src/agent-pool.ts";
import { RequestAbortedError } from "../src/errors.ts";
import { createTestServer } from "./test-utils.ts";

describe("agent-pool.ts", () => {
    const testServer = createTestServer();

    afterAll(async () => {
        await testServer.stop();
    });

    test("pool handles concurrent requests successfully", async () => {
        const pool = createAgentPool(testServer.baseUrl, {
            poolMaxPerHost: 4,
        });

        try {
            const requests = Array.from({ length: 8 }, (_, index) =>
                pool
                    .send({
                        url: `${testServer.baseUrl}/echo`,
                        method: "POST",
                        headers: new Headers({
                            "content-type": "application/json",
                        }),
                        body: JSON.stringify({ index }),
                    })
                    .then((response) => response.json()),
            );

            const results = await Promise.all(requests);

            expect(results).toHaveLength(8);
            for (const result of results) {
                expect(result.method).toBe("POST");
            }
        } finally {
            await pool.close();
        }
    });

    test("pool queues requests when poolMaxPerHost is small", async () => {
        const pool = createAgentPool(testServer.baseUrl, {
            poolMaxPerHost: 2,
        });

        try {
            const startedAt = performance.now();

            const requests = Array.from({ length: 4 }, () =>
                pool
                    .send({
                        url: `${testServer.baseUrl}/slow`,
                        method: "GET",
                    })
                    .then((response) => response.text()),
            );

            const results = await Promise.all(requests);
            const elapsed = performance.now() - startedAt;

            expect(results).toEqual([
                "Finally!",
                "Finally!",
                "Finally!",
                "Finally!",
            ]);

            expect(elapsed).toBeGreaterThanOrEqual(300);
        } finally {
            await pool.close();
        }
    });

    test("pool propagates abort signals as RequestAbortedError", async () => {
        const pool = createAgentPool(testServer.baseUrl, {
            poolMaxPerHost: 2,
        });

        try {
            const controller = new AbortController();

            const request = pool.send({
                url: `${testServer.baseUrl}/slow`,
                method: "GET",
                signal: controller.signal,
            });

            setTimeout(() => controller.abort(new Error("abort test")), 50);

            await expect(request).rejects.toBeInstanceOf(RequestAbortedError);
        } finally {
            await pool.close();
        }
    });

    test("pool closes cleanly via close()", async () => {
        const pool = createAgentPool(testServer.baseUrl, {
            poolMaxPerHost: 2,
        });

        const response = await pool.send({
            url: `${testServer.baseUrl}/text`,
            method: "GET",
        });
        expect(await response.text()).toBe("Hello, World!");

        await expect(pool.close()).resolves.toBeUndefined();
    });
});
