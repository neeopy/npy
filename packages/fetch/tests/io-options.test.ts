import { afterAll, describe, expect, test } from "bun:test";
import {
    ResponseBodyError,
    ResponseDecodeError,
    ResponseHeaderError,
} from "../src/errors.ts";
import { HttpClient } from "../src/fetch.ts";
import { createTestServer } from "./test-utils.ts";

describe("high-level I/O options", () => {
    const testServer = createTestServer();

    afterAll(async () => {
        await testServer.stop();
    });

    test("reader.maxHeaderSize is enforced through HttpClient -> AgentPool -> Agent", async () => {
        const client = new HttpClient({
            io: {
                reader: {
                    maxHeaderSize: 64,
                },
            },
        });

        try {
            await expect(
                client.send({
                    url: `${testServer.baseUrl}/huge-header`,
                    method: "GET",
                }),
            ).rejects.toBeInstanceOf(ResponseHeaderError);
        } finally {
            await client.close();
        }
    });

    test("reader.maxBodySize is enforced while consuming the body stream", async () => {
        const client = new HttpClient({
            io: {
                reader: {
                    maxBodySize: 128,
                },
            },
        });

        try {
            const response = await client.send({
                url: `${testServer.baseUrl}/large-stream`,
                method: "GET",
            });

            await expect(response.text()).rejects.toBeInstanceOf(
                ResponseBodyError,
            );
        } finally {
            await client.close();
        }
    });

    test("reader.maxDecodedBodySize errors while consuming the decoded body", async () => {
        const client = new HttpClient({
            io: {
                reader: {
                    maxDecodedBodySize: 8,
                },
            },
        });

        try {
            const response = await client.send({
                url: `${testServer.baseUrl}/gzip`,
                method: "GET",
            });

            await expect(response.text()).rejects.toBeInstanceOf(
                ResponseBodyError,
            );
        } finally {
            await client.close();
        }
    });

    test("decoding failures surface as ResponseDecodeError on the advanced API", async () => {
        const client = new HttpClient();

        try {
            const response = await client.send({
                url: `${testServer.baseUrl}/bad-gzip`,
                method: "GET",
            });

            await expect(response.text()).rejects.toBeInstanceOf(
                ResponseDecodeError,
            );
        } finally {
            await client.close();
        }
    });

    test("reader.decompress=false keeps the compressed payload untouched", async () => {
        const client = new HttpClient({
            io: {
                reader: {
                    decompress: false,
                },
            },
        });

        try {
            const response = await client.send({
                url: `${testServer.baseUrl}/gzip`,
                method: "GET",
            });

            expect(response.headers.get("content-encoding")).toBe("gzip");

            const body = new Uint8Array(await response.arrayBuffer());
            expect(body.byteLength).toBeGreaterThan(0);
            expect(new TextDecoder().decode(body)).not.toBe(
                "This is compressed content!",
            );
        } finally {
            await client.close();
        }
    });
});
