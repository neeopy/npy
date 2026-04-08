import { afterAll, describe, expect, test } from "bun:test";
import { createTestServer, sleep } from "./test-utils";

describe("process exit with idle pooled connections", () => {
    const testServer = createTestServer();

    afterAll(async () => {
        await testServer.stop();
    });

    test("client does not require explicit close() once the pooled connection is idle", async () => {
        const httpClientModuleUrl = new URL(
            "../src/http-client.ts",
            import.meta.url,
        ).href;

        const code = `
            const { HttpClient } = await import(${JSON.stringify(httpClientModuleUrl)});

            const client = new HttpClient({
                poolMaxPerHost: 1,
                poolMaxIdlePerHost: 1,
                poolIdleTimeout: 30_000,
                connect: {
                    keepAlive: true,
                    noDelay: true,
                },
            });

            const response = await client.send({
                url: ${JSON.stringify(`${testServer.baseUrl}/text`)},
                method: "GET",
            });

            const body = await response.text();
            if (body !== "Hello, World!") {
                throw new Error("unexpected response body");
            }

            // Do not call client.close().
            // The idle socket and the idle-eviction timer must both be unref'ed.
            await Promise.resolve();
            await Promise.resolve();
        `;

        const child = Bun.spawn([process.execPath, "--eval", code], {
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
        });

        const exited = await Promise.race([
            child.exited.then(() => true),
            sleep(1_500).then(() => false),
        ]);

        if (!exited) {
            child.kill();
        }

        const stdout = await new Response(child.stdout).text();
        const stderr = await new Response(child.stderr).text();

        expect(exited).toBe(true);
        expect(await child.exited).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toBe("");
    });
});
