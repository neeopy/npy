import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import { extractBody, getFormDataLength } from "../src/body";

async function readAllBytes(readable: Readable): Promise<Uint8Array> {
    const chunks: Buffer[] = [];
    for await (const chunk of readable) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return new Uint8Array(Buffer.concat(chunks));
}

function parseBoundary(contentType: string): string {
    const match = /boundary=([^\s;]+)/.exec(contentType);
    if (!match) throw new Error(`No boundary in: ${contentType}`);
    return match[1]!;
}

describe("extractBody", () => {
    test("null returns empty body with zero content-length", () => {
        const state = extractBody(null);
        expect(state.body).toBeNull();
        expect(state.contentLength).toBe(0);
        expect(state.contentType).toBeNull();
    });

    test("string sets UTF-8 content-type and correct byte length", () => {
        const state = extractBody("héllo");
        expect(state.body).toBeInstanceOf(Uint8Array);
        expect(state.contentType).toBe("text/plain;charset=UTF-8");

        expect(state.contentLength).toBe(6);
    });

    test("Uint8Array passes through with exact size", () => {
        const bytes = new Uint8Array([10, 20, 30, 40]);
        const state = extractBody(bytes);
        expect(state.body).toBe(bytes);
        expect(state.contentLength).toBe(4);
        expect(state.contentType).toBeNull();
    });

    test("URLSearchParams sets form-urlencoded content-type", () => {
        const params = new URLSearchParams({ a: "1", b: "2" });
        const state = extractBody(params);
        expect(state.contentType).toContain(
            "application/x-www-form-urlencoded",
        );
        expect(state.body).toBeInstanceOf(Uint8Array);
        const text = new TextDecoder().decode(state.body as Uint8Array);
        expect(text).toBe("a=1&b=2");
    });

    test("FormData sets multipart content-type with boundary", () => {
        const form = new FormData();
        form.append("key", "value");

        const state = extractBody(form);
        expect(state.contentType).toContain("multipart/form-data");
        expect(state.contentType).toContain("boundary=");
        expect(state.contentLength).toBeGreaterThan(0);
        expect(state.body).toBeInstanceOf(Readable);
    });

    test("empty FormData produces a valid (footer-only) body", () => {
        const state = extractBody(new FormData());
        expect(state.contentType).toContain("multipart/form-data");
        expect(state.contentLength).toBeGreaterThan(0);

        expect(state.body).toBeInstanceOf(Readable);
    });

    test("ReadableStream body is passed through unchanged", () => {
        const stream = new ReadableStream();
        const state = extractBody(stream);
        expect(state.body).toBe(stream);
        expect(state.contentLength).toBeNull();
    });
});

describe("getFormDataLength", () => {
    test("matches actual serialized byte count — text-only fields", async () => {
        const form = new FormData();
        form.append("username", "alice");
        form.append("email", "alice@example.com");

        const state = extractBody(form);
        const boundary = parseBoundary(state.contentType!);
        const declared = getFormDataLength(form, boundary);

        const actual = await readAllBytes(state.body as Readable);
        expect(actual.byteLength).toBe(declared);
    });

    test("matches actual serialized byte count — single Blob field", async () => {
        const form = new FormData();
        form.append(
            "file",
            new Blob(["binary content"], { type: "application/octet-stream" }),
            "data.bin",
        );

        const state = extractBody(form);
        const boundary = parseBoundary(state.contentType!);
        const declared = getFormDataLength(form, boundary);

        const actual = await readAllBytes(state.body as Readable);
        expect(actual.byteLength).toBe(declared);
    });

    test("matches actual serialized byte count — mixed text and Blob fields", async () => {
        const form = new FormData();
        form.append("description", "a short text");
        form.append(
            "attachment",
            new Blob(["<html></html>"], { type: "text/html" }),
            "page.html",
        );
        form.append("tag", "important");

        const state = extractBody(form);
        const boundary = parseBoundary(state.contentType!);
        const declared = getFormDataLength(form, boundary);

        const actual = await readAllBytes(state.body as Readable);
        expect(actual.byteLength).toBe(declared);
    });

    test("matches for empty FormData", async () => {
        const form = new FormData();

        const state = extractBody(form);
        const boundary = parseBoundary(state.contentType!);
        const declared = getFormDataLength(form, boundary);

        const actual = await readAllBytes(state.body as Readable);
        expect(actual.byteLength).toBe(declared);
    });

    test("matches for multibyte UTF-8 field value", async () => {
        const form = new FormData();
        form.append("greeting", "こんにちは");

        const state = extractBody(form);
        const boundary = parseBoundary(state.contentType!);
        const declared = getFormDataLength(form, boundary);

        const actual = await readAllBytes(state.body as Readable);
        expect(actual.byteLength).toBe(declared);
    });
});

describe("multipart wire format", () => {
    test("text field produces valid multipart structure", async () => {
        const form = new FormData();
        form.append("name", "bob");

        const state = extractBody(form);
        const boundary = parseBoundary(state.contentType!);
        const bytes = await readAllBytes(state.body as Readable);
        const text = new TextDecoder().decode(bytes);

        expect(text).toContain(`--${boundary}\r\n`);
        expect(text).toContain(`Content-Disposition: form-data; name="name"`);
        expect(text).toContain(`\r\n\r\nbob\r\n`);
        expect(text).toContain(`--${boundary}--`);
    });

    test("Blob field includes filename and Content-Type headers", async () => {
        const form = new FormData();
        form.append(
            "upload",
            new Blob(["data"], { type: "text/plain" }),
            "notes.txt",
        );

        const state = extractBody(form);
        const bytes = await readAllBytes(state.body as Readable);
        const text = new TextDecoder().decode(bytes);

        expect(text).toContain(`filename="notes.txt"`);
        expect(text).toContain(`Content-Type: text/plain`);
        expect(text).toContain(`data`);
    });

    test("Blob without explicit filename falls back to 'blob'", async () => {
        const form = new FormData();

        form.append("f", new Blob(["x"]));

        const state = extractBody(form);
        const bytes = await readAllBytes(state.body as Readable);
        const text = new TextDecoder().decode(bytes);

        expect(text).toContain(`filename="blob"`);
    });

    test("Blob without type falls back to application/octet-stream", async () => {
        const form = new FormData();
        form.append("f", new Blob(["x"]), "file.dat");

        const state = extractBody(form);
        const bytes = await readAllBytes(state.body as Readable);
        const text = new TextDecoder().decode(bytes);

        expect(text).toContain(`Content-Type: application/octet-stream`);
    });

    test("each field is separated by boundary", async () => {
        const form = new FormData();
        form.append("a", "1");
        form.append("b", "2");
        form.append("c", "3");

        const state = extractBody(form);
        const boundary = parseBoundary(state.contentType!);
        const bytes = await readAllBytes(state.body as Readable);
        const text = new TextDecoder().decode(bytes);

        const openings = (
            text.match(new RegExp(`--${boundary}\r\n`, "g")) ?? []
        ).length;
        const closing = (text.match(new RegExp(`--${boundary}--`, "g")) ?? [])
            .length;
        expect(openings).toBe(3);
        expect(closing).toBe(1);
    });
});
