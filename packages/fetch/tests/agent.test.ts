import { afterAll, describe, expect, test } from "bun:test";
import { ITcpConnection } from "@fuman/net";
import { createAgent } from "../src/agent";
import { AutoDialer } from "../src/dialers";
import {
    AgentBusyError,
    OriginMismatchError,
    RequestAbortedError,
    ResponseDecodeError,
} from "../src/errors";
import type { Dialer } from "../src/types/dialer";
import { createTestServer } from "./test-utils";

class FakeSocketHandle {
    refCalls = 0;
    unrefCalls = 0;

    ref(): void {
        this.refCalls += 1;
    }

    unref(): void {
        this.unrefCalls += 1;
    }
}

function toPlainBytes(value: string): Uint8Array<ArrayBuffer> {
    // Force a plain ArrayBuffer-backed Uint8Array so TS does not widen to
    // Uint8Array<ArrayBufferLike> under newer DOM/lib typings.
    return new Uint8Array(new TextEncoder().encode(value));
}

class ScriptedReusableConnection implements ITcpConnection {
    readonly socket: FakeSocketHandle;
    readonly localAddress = {
        address: "127.0.0.1",
        port: 12_345,
    };
    readonly remoteAddress = {
        address: "127.0.0.1",
        port: 80,
    };

    readonly writes: Uint8Array[] = [];

    #closed = false;
    #pendingBytes: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));
    #readOffset = 0;
    #responseQueue: Uint8Array<ArrayBuffer>[];

    constructor(responses: string[], socket: FakeSocketHandle) {
        this.socket = socket;
        this.#responseQueue = responses.map(toPlainBytes);
    }

    setKeepAlive(): void {}

    setNoDelay(): void {}

    close(): void {
        this.#closed = true;
    }

    async write(bytes: Uint8Array): Promise<void> {
        if (this.#closed) {
            throw new Error("connection is closed");
        }

        this.writes.push(new Uint8Array(bytes));

        // Publish exactly one response per request write.
        // This avoids pre-buffering a future response into the previous
        // LineReader instance, which would make the test unrealistic.
        if (this.#readOffset >= this.#pendingBytes.length) {
            this.#pendingBytes =
                this.#responseQueue.shift() ??
                new Uint8Array(new ArrayBuffer(0));
            this.#readOffset = 0;
        }
    }

    async read(into: Uint8Array): Promise<number> {
        if (this.#closed) {
            return 0;
        }

        const remaining = this.#pendingBytes.length - this.#readOffset;
        if (remaining <= 0) {
            return 0;
        }

        const n = Math.min(into.length, remaining);
        into.set(
            this.#pendingBytes.subarray(this.#readOffset, this.#readOffset + n),
        );
        this.#readOffset += n;
        return n;
    }
}

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

    test("agent refs active connections and unreferences reusable idle sockets", async () => {
        const socket = new FakeSocketHandle();
        const connection = new ScriptedReusableConnection(
            [
                "HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello",
                "HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nworld",
            ],
            socket,
        );

        let dialCalls = 0;

        const fakeDialer: Dialer = {
            async dial() {
                dialCalls += 1;
                return connection;
            },
        };

        const agent = createAgent(fakeDialer, "http://example.test");

        try {
            const response1 = await agent.send({
                url: "http://example.test/one",
                method: "GET",
            });
            expect(await response1.text()).toBe("hello");
            await agent.whenIdle();

            const response2 = await agent.send({
                url: "http://example.test/two",
                method: "GET",
            });
            expect(await response2.text()).toBe("world");
            await agent.whenIdle();

            expect(dialCalls).toBe(1);
            expect(socket.refCalls).toBe(2);
            expect(socket.unrefCalls).toBe(2);
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
