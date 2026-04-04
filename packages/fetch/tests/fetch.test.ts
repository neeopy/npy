import { afterAll, describe, expect, test } from "bun:test";
import { createFetch, HttpClient, normalizeHeaders } from "../src/fetch";
import { createTestServer } from "./test-utils";

describe("fetch.ts weblike API", () => {
    const testServer = createTestServer();

    afterAll(async () => {
        await testServer.stop();
    });

    async function withEnv(
        values: Partial<Record<string, string | undefined>>,
        run: () => Promise<void>,
    ): Promise<void> {
        const previous = new Map<string, string | undefined>();

        for (const [key, value] of Object.entries(values)) {
            previous.set(key, process.env[key]);
            if (value == null) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }

        try {
            await run();
        } finally {
            for (const [key, value] of previous) {
                if (value == null) {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
        }
    }

    test("normalizeHeaders preserves tuples, records and Headers", () => {
        const fromRecord = normalizeHeaders({
            "x-one": "1",
            "x-two": "2",
        });
        expect(fromRecord.get("x-one")).toBe("1");
        expect(fromRecord.get("x-two")).toBe("2");

        const fromTuples = normalizeHeaders([
            ["x-a", "a"],
            ["x-b", "b"],
        ]);
        expect(fromTuples.get("x-a")).toBe("a");
        expect(fromTuples.get("x-b")).toBe("b");

        const headers = new Headers({ "x-test": "ok" });
        const same = normalizeHeaders(headers);
        expect(same).toBe(headers);
    });

    test("createFetch performs a basic GET request", async () => {
        const fetchLike = createFetch();

        try {
            const response = await fetchLike(`${testServer.baseUrl}/text`);
            expect(response.status).toBe(200);
            expect(response.ok).toBe(true);
            expect(await response.text()).toBe("Hello, World!");
        } finally {
            await fetchLike.close();
        }
    });

    test("HttpClient raw API performs POST JSON requests", async () => {
        const client = new HttpClient();

        try {
            const response = await client.send({
                url: `${testServer.baseUrl}/echo`,
                method: "POST",
                headers: new Headers({
                    "content-type": "application/json",
                }),
                body: JSON.stringify({ test: "data" }),
            });

            expect(response.status).toBe(200);

            const echo = await response.json();
            expect(echo.method).toBe("POST");
            expect(echo.headers["content-type"]).toContain("application/json");
            expect(echo.bodyText).toBe(JSON.stringify({ test: "data" }));
        } finally {
            await client.close();
        }
    });

    test("Request input is accepted and body/method are inherited", async () => {
        const fetchLike = createFetch();

        try {
            const request = new Request(`${testServer.baseUrl}/echo`, {
                method: "POST",
                headers: {
                    "content-type": "text/plain;charset=utf-8",
                },
                body: "from-request-object",
            });

            const response = await fetchLike(request);
            expect(response.status).toBe(200);

            const echo = await response.json();
            expect(echo.method).toBe("POST");
            expect(echo.bodyText).toBe("from-request-object");
        } finally {
            await fetchLike.close();
        }
    });

    test("URLSearchParams bodies are encoded and content-type is set", async () => {
        const fetchLike = createFetch();

        try {
            const body = new URLSearchParams({
                username: "john",
                password: "secret123",
            });

            const response = await fetchLike(`${testServer.baseUrl}/echo`, {
                method: "POST",
                body,
            });

            expect(response.status).toBe(200);

            const echo = await response.json();
            expect(echo.headers["content-type"]).toContain(
                "application/x-www-form-urlencoded",
            );
            expect(echo.bodyText).toBe("username=john&password=secret123");
        } finally {
            await fetchLike.close();
        }
    });

    test("compressed responses are transparently decompressed", async () => {
        const fetchLike = createFetch();

        try {
            const response = await fetchLike(`${testServer.baseUrl}/gzip`);
            expect(response.status).toBe(200);
            expect(await response.text()).toBe("This is compressed content!");
        } finally {
            await fetchLike.close();
        }
    });

    test("redirects follow by default and annotate the final response", async () => {
        const fetchLike = createFetch();

        try {
            const response = await fetchLike(`${testServer.baseUrl}/redirect`);
            expect(response.status).toBe(200);
            expect(response.redirected).toBe(true);
            expect(response.url).toBe(
                `${testServer.baseUrl}/redirected-target`,
            );
            expect(await response.text()).toBe("You followed the redirect");
        } finally {
            await fetchLike.close();
        }
    });

    test("redirect mode manual returns the original redirect response", async () => {
        const fetchLike = createFetch();

        try {
            const response = await fetchLike(`${testServer.baseUrl}/redirect`, {
                redirect: "manual",
            });
            expect(response.status).toBe(302);
            expect(response.redirected).toBe(false);
            expect(response.url).toBe(`${testServer.baseUrl}/redirect`);
            expect(response.headers.get("location")).toBe("/redirected-target");
            expect(await response.text()).toBe(
                "Redirecting to /redirected-target",
            );
        } finally {
            await fetchLike.close();
        }
    });

    test("redirect mode error rejects with TypeError", async () => {
        const fetchLike = createFetch();

        try {
            await expect(
                fetchLike(`${testServer.baseUrl}/redirect`, {
                    redirect: "error",
                }),
            ).rejects.toBeInstanceOf(TypeError);
        } finally {
            await fetchLike.close();
        }
    });

    test("GET and HEAD requests reject explicit bodies", async () => {
        const fetchLike = createFetch();

        try {
            await expect(
                fetchLike(`${testServer.baseUrl}/echo`, {
                    method: "GET",
                    body: "invalid",
                }),
            ).rejects.toBeInstanceOf(TypeError);

            await expect(
                fetchLike(`${testServer.baseUrl}/echo`, {
                    method: "HEAD",
                    body: "invalid",
                }),
            ).rejects.toBeInstanceOf(TypeError);
        } finally {
            await fetchLike.close();
        }
    });

    test("fetch rejects URLs with embedded credentials", async () => {
        const fetchLike = createFetch();

        try {
            await expect(
                fetchLike(
                    `http://user:pass@127.0.0.1:${new URL(testServer.baseUrl).port}/text`,
                ),
            ).rejects.toBeInstanceOf(TypeError);
        } finally {
            await fetchLike.close();
        }
    });

    test("fetch rejects network failures with TypeError", async () => {
        const fetchLike = createFetch();

        try {
            await expect(
                fetchLike("http://127.0.0.1:1/"),
            ).rejects.toBeInstanceOf(TypeError);
        } finally {
            await fetchLike.close();
        }
    });

    test("environment proxies are used when no explicit proxy is provided", async () => {
        const fetchLike = createFetch();

        try {
            await withEnv(
                {
                    HTTP_PROXY: "http://127.0.0.1:1",
                    HTTPS_PROXY: undefined,
                    SOCKS5_PROXY: undefined,
                    SOCKS_PROXY: undefined,
                },
                async () => {
                    await expect(
                        fetchLike(`${testServer.baseUrl}/text`),
                    ).rejects.toBeInstanceOf(TypeError);
                },
            );
        } finally {
            await fetchLike.close();
        }
    });

    test("proxy: null disables environment proxy resolution", async () => {
        const fetchLike = createFetch();

        try {
            await withEnv(
                {
                    HTTP_PROXY: "http://127.0.0.1:1",
                    HTTPS_PROXY: undefined,
                    SOCKS5_PROXY: undefined,
                    SOCKS_PROXY: undefined,
                },
                async () => {
                    const response = await fetchLike(
                        `${testServer.baseUrl}/text`,
                        {
                            proxy: null,
                        },
                    );
                    expect(response.status).toBe(200);
                    expect(await response.text()).toBe("Hello, World!");
                },
            );
        } finally {
            await fetchLike.close();
        }
    });

    test("proxy accepts ProxyInfo objects directly", async () => {
        const fetchLike = createFetch();

        try {
            await expect(
                fetchLike(`${testServer.baseUrl}/text`, {
                    proxy: {
                        protocol: "http",
                        host: "127.0.0.1",
                        port: 1,
                    },
                }),
            ).rejects.toBeInstanceOf(TypeError);
        } finally {
            await fetchLike.close();
        }
    });

    test("abort signals cancel in-flight requests with AbortError DOMException", async () => {
        const fetchLike = createFetch();

        try {
            const controller = new AbortController();
            const promise = fetchLike(`${testServer.baseUrl}/slow`, {
                signal: controller.signal,
            });

            setTimeout(() => controller.abort(), 50);

            await expect(promise).rejects.toMatchObject({
                name: "AbortError",
            });
        } finally {
            await fetchLike.close();
        }
    });

    test("AbortSignal.timeout() is preserved as TimeoutError", async () => {
        const fetchLike = createFetch();

        try {
            await expect(
                fetchLike(`${testServer.baseUrl}/slow`, {
                    signal: AbortSignal.timeout(10),
                }),
            ).rejects.toMatchObject({
                name: "TimeoutError",
            });
        } finally {
            await fetchLike.close();
        }
    });

    test("body decoding failures become TypeError on the public fetch API", async () => {
        const fetchLike = createFetch();

        try {
            const response = await fetchLike(`${testServer.baseUrl}/bad-gzip`);
            await expect(response.text()).rejects.toBeInstanceOf(TypeError);
        } finally {
            await fetchLike.close();
        }
    });

    test("body abort after headers becomes AbortError on the public fetch API", async () => {
        const fetchLike = createFetch();

        try {
            const controller = new AbortController();
            const response = await fetchLike(
                `${testServer.baseUrl}/slow-body`,
                {
                    signal: controller.signal,
                },
            );

            controller.abort();

            await expect(response.text()).rejects.toMatchObject({
                name: "AbortError",
            });
        } finally {
            await fetchLike.close();
        }
    });

    test("second body read rejects with TypeError", async () => {
        const fetchLike = createFetch();

        try {
            const response = await fetchLike(`${testServer.baseUrl}/text`);
            expect(await response.text()).toBe("Hello, World!");
            await expect(response.text()).rejects.toBeInstanceOf(TypeError);
        } finally {
            await fetchLike.close();
        }
    });

    test("HttpClient.close() allows fresh pools on later requests", async () => {
        const client = new HttpClient();

        const first = await client.send({
            url: `${testServer.baseUrl}/text`,
            method: "GET",
        });
        expect(await first.text()).toBe("Hello, World!");

        await client.close();

        const second = await client.send({
            url: `${testServer.baseUrl}/text`,
            method: "GET",
        });
        expect(await second.text()).toBe("Hello, World!");

        await client.close();
    });
});
