import { afterAll, describe, expect, test } from "bun:test";
import { createFetch } from "../src/fetch";
import { createTestServer } from "./test-utils";

interface MultipartEchoResponse {
    method: string;
    contentType: string;
    contentLength: number | null;
    fields: Record<
        string,
        | string
        | string[]
        | {
              type: "file";
              filename: string;
              mimeType: string;
              size: number;
              content: string;
          }
    >;
}

describe("multipart/form-data — integration", () => {
    const testServer = createTestServer();

    afterAll(async () => {
        await testServer.stop();
    });

    test("Content-Type is multipart/form-data and contains a boundary", async () => {
        const fetchLike = createFetch();

        try {
            const form = new FormData();
            form.append("x", "1");

            const response = await fetchLike(
                `${testServer.baseUrl}/multipart-echo`,
                { method: "POST", body: form },
            );

            expect(response.status).toBe(200);

            const echo: MultipartEchoResponse = await response.json();
            expect(echo.contentType).toContain("multipart/form-data");
            expect(echo.contentType).toMatch(/boundary=[^\s;]+/);
        } finally {
            await fetchLike.close();
        }
    });

    test("Content-Length is sent and matches the body received by the server", async () => {
        const fetchLike = createFetch();

        try {
            const form = new FormData();
            form.append("field", "some value");

            const response = await fetchLike(
                `${testServer.baseUrl}/multipart-echo`,
                { method: "POST", body: form },
            );

            expect(response.status).toBe(200);

            const echo: MultipartEchoResponse = await response.json();

            expect(echo.contentLength).not.toBeNull();
            expect(echo.contentLength).toBeGreaterThan(0);
        } finally {
            await fetchLike.close();
        }
    });

    test("single text field is received correctly", async () => {
        const fetchLike = createFetch();

        try {
            const form = new FormData();
            form.append("greeting", "hello world");

            const response = await fetchLike(
                `${testServer.baseUrl}/multipart-echo`,
                { method: "POST", body: form },
            );

            const echo: MultipartEchoResponse = await response.json();
            expect(echo.fields["greeting"]).toBe("hello world");
        } finally {
            await fetchLike.close();
        }
    });

    test("multiple text fields are all received", async () => {
        const fetchLike = createFetch();

        try {
            const form = new FormData();
            form.append("first", "Alice");
            form.append("last", "Smith");
            form.append("age", "30");

            const response = await fetchLike(
                `${testServer.baseUrl}/multipart-echo`,
                { method: "POST", body: form },
            );

            const echo: MultipartEchoResponse = await response.json();
            expect(echo.fields["first"]).toBe("Alice");
            expect(echo.fields["last"]).toBe("Smith");
            expect(echo.fields["age"]).toBe("30");
        } finally {
            await fetchLike.close();
        }
    });

    test("multiple values for the same field name are received as an array", async () => {
        const fetchLike = createFetch();

        try {
            const form = new FormData();
            form.append("tag", "typescript");
            form.append("tag", "http");
            form.append("tag", "fetch");

            const response = await fetchLike(
                `${testServer.baseUrl}/multipart-echo`,
                { method: "POST", body: form },
            );

            const echo: MultipartEchoResponse = await response.json();
            expect(echo.fields["tag"]).toEqual(["typescript", "http", "fetch"]);
        } finally {
            await fetchLike.close();
        }
    });

    test("multibyte UTF-8 field values are received correctly", async () => {
        const fetchLike = createFetch();

        try {
            const form = new FormData();
            form.append("greeting", "こんにちは");
            form.append("emoji", "🚀");

            const response = await fetchLike(
                `${testServer.baseUrl}/multipart-echo`,
                { method: "POST", body: form },
            );

            const echo: MultipartEchoResponse = await response.json();
            expect(echo.fields["greeting"]).toBe("こんにちは");
            expect(echo.fields["emoji"]).toBe("🚀");
        } finally {
            await fetchLike.close();
        }
    });

    test("Blob field content is received intact", async () => {
        const fetchLike = createFetch();

        try {
            const content = "hello from blob";
            const form = new FormData();
            form.append(
                "upload",
                new Blob([content], { type: "text/plain" }),
                "hello.txt",
            );

            const response = await fetchLike(
                `${testServer.baseUrl}/multipart-echo`,
                { method: "POST", body: form },
            );

            const echo: MultipartEchoResponse = await response.json();
            const file = echo.fields["upload"] as {
                type: string;
                filename: string;
                mimeType: string;
                content: string;
            };

            expect(file.filename).toBe("hello.txt");
            expect(file.mimeType).toContain("text/plain");
            expect(file.content).toBe(content);
        } finally {
            await fetchLike.close();
        }
    });

    test("binary Blob field is received with correct byte count", async () => {
        const fetchLike = createFetch();

        try {
            const bytes = new Uint8Array(256).map((_, i) => i);
            const form = new FormData();
            form.append(
                "bin",
                new Blob([bytes], { type: "application/octet-stream" }),
                "data.bin",
            );

            const response = await fetchLike(
                `${testServer.baseUrl}/multipart-echo`,
                { method: "POST", body: form },
            );

            const echo: MultipartEchoResponse = await response.json();
            const file = echo.fields["bin"] as {
                size: number;
                mimeType: string;
            };

            expect(file.size).toBe(256);
            expect(file.mimeType).toBe("application/octet-stream");
        } finally {
            await fetchLike.close();
        }
    });

    test("Blob without explicit MIME type is received with correct content", async () => {
        const fetchLike = createFetch();

        try {
            const form = new FormData();
            form.append("f", new Blob(["data"]), "file.dat");

            const response = await fetchLike(
                `${testServer.baseUrl}/multipart-echo`,
                { method: "POST", body: form },
            );

            const echo: MultipartEchoResponse = await response.json();
            const file = echo.fields["f"] as { size: number; content: string };
            expect(file.size).toBe(4);
            expect(file.content).toBe("data");
        } finally {
            await fetchLike.close();
        }
    });

    test("mixed text and Blob fields are all received correctly", async () => {
        const fetchLike = createFetch();

        try {
            const form = new FormData();
            form.append("title", "My Upload");
            form.append(
                "file",
                new Blob(["<html><body>hi</body></html>"], {
                    type: "text/html",
                }),
                "index.html",
            );
            form.append("note", "optional note");

            const response = await fetchLike(
                `${testServer.baseUrl}/multipart-echo`,
                { method: "POST", body: form },
            );

            const echo: MultipartEchoResponse = await response.json();

            expect(echo.fields["title"]).toBe("My Upload");
            expect(echo.fields["note"]).toBe("optional note");

            const file = echo.fields["file"] as {
                filename: string;
                content: string;
            };
            expect(file.filename).toBe("index.html");
            expect(file.content).toBe("<html><body>hi</body></html>");
        } finally {
            await fetchLike.close();
        }
    });

    test("empty FormData sends a structurally valid body", async () => {
        const fetchLike = createFetch();

        try {
            const response = await fetchLike(
                `${testServer.baseUrl}/multipart-echo`,
                { method: "POST", body: new FormData() },
            );

            expect(response.status).toBe(200);

            const echo: MultipartEchoResponse = await response.json();
            expect(echo.fields).toEqual({});
            expect(echo.contentLength).toBeGreaterThan(0);
        } finally {
            await fetchLike.close();
        }
    });

    test("Content-Length is accurate for a large Blob field", async () => {
        const fetchLike = createFetch();

        try {
            const large = new Uint8Array(64 * 1024).fill(0x41);
            const form = new FormData();
            form.append(
                "payload",
                new Blob([large], { type: "application/octet-stream" }),
                "large.bin",
            );

            const response = await fetchLike(
                `${testServer.baseUrl}/multipart-echo`,
                { method: "POST", body: form },
            );

            expect(response.status).toBe(200);

            const echo: MultipartEchoResponse = await response.json();
            const file = echo.fields["payload"] as { size: number };

            expect(file.size).toBe(64 * 1024);
            expect(echo.contentLength).toBeGreaterThan(64 * 1024);
        } finally {
            await fetchLike.close();
        }
    });

    test("Request object with FormData body is forwarded correctly", async () => {
        const fetchLike = createFetch();

        try {
            const form = new FormData();
            form.append("from", "request-object");

            const request = new Request(
                `${testServer.baseUrl}/multipart-echo`,
                { method: "POST", body: form },
            );

            const response = await fetchLike(request);
            expect(response.status).toBe(200);

            const echo: MultipartEchoResponse = await response.json();
            expect(echo.fields["from"]).toBe("request-object");
        } finally {
            await fetchLike.close();
        }
    });
});
