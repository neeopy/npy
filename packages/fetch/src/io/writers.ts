import type { ISyncWritable, IWritable } from "@fuman/io";
import { Bytes, write as ioWrite } from "@fuman/io";
import { nodeReadableToWeb } from "@fuman/node";
import { CRLF_STR } from "../_internal/consts";
import { isReadableStream } from "../_internal/guards";
import { bytesToStream } from "../_internal/streams";
import { type BodyInit, extractBody } from "../body";
import { createEncoders, encodeStream } from "../encoding";
import { parseContentLength, parseTransferEncoding } from "./_utils";
import { BufWriter } from "./buf-writer";
import { sanitizeHeaderValue } from "./readers";

type Destination = IWritable;
type ByteStream = ReadableStream<Uint8Array>;

type PreparedBody =
    | { kind: "none" }
    | { kind: "bytes"; bytes: Uint8Array; length: number }
    | { kind: "stream"; stream: ByteStream; length: number | null };

type RequestHead = {
    method: string;
    target: string;
    headers: Headers;
};

export namespace Writers {
    export interface Options {
        highWaterMark?: number;
        directWriteThreshold?: number;
        coalesceBodyMaxBytes?: number;
    }

    export interface Request {
        url: URL;
        method: string;
        headers?: Headers;
        body?: BodyInit | null;
        signal?: AbortSignal;
    }

    export interface Writer {
        write(req: Request): Promise<void>;
    }
}

function toRequestTarget(url: URL): string {
    const pathname = url.pathname?.startsWith("/") ? url.pathname : "/";
    return pathname + (url.search || "");
}

function encodeHead(into: ISyncWritable, head: RequestHead): void {
    ioWrite.rawString(
        into,
        `${head.method.toUpperCase()} ${head.target} HTTP/1.1${CRLF_STR}`,
    );

    for (const [k, v] of head.headers) {
        ioWrite.rawString(into, `${k}: ${sanitizeHeaderValue(v)}${CRLF_STR}`);
    }

    ioWrite.rawString(into, CRLF_STR);
}

function prepareBody(headers: Headers, init: BodyInit | null): PreparedBody {
    const state = extractBody(init);

    if (state.body != null && !headers.has("content-type")) {
        headers.set(
            "content-type",
            state.contentType ?? "application/octet-stream",
        );
    }

    const body = state.body;
    if (body == null) return { kind: "none" };

    if (body instanceof Uint8Array) {
        return { kind: "bytes", bytes: body, length: body.byteLength };
    }

    if (isReadableStream(body)) {
        return {
            kind: "stream",
            stream: body as ByteStream,
            length: state.contentLength,
        };
    }

    return {
        kind: "stream",
        stream: nodeReadableToWeb(body) as ByteStream,
        length: state.contentLength,
    };
}

function finalizeDelimitation(
    headers: Headers,
    body: PreparedBody,
): { chunked: boolean } {
    if (body.kind === "none") return { chunked: false };

    const te = parseTransferEncoding(headers);
    if (te.has) {
        headers.delete("content-length");

        if (!te.chunked) {
            const tokens = [...te.codings, "chunked"].filter(Boolean);
            headers.set("transfer-encoding", tokens.join(", "));
        }

        return { chunked: true };
    }

    const knownLength =
        body.kind === "bytes" ? body.length : (body.length ?? null);
    if (knownLength != null) {
        const existing = parseContentLength(headers);
        if (existing != null && existing !== knownLength) {
            throw new Error(
                `Conflicting content-length: header=${existing} body=${knownLength}`,
            );
        }
        if (existing == null) {
            headers.set("content-length", String(knownLength));
        }
        return { chunked: false };
    }

    const existing = parseContentLength(headers);
    if (existing != null) return { chunked: false };

    headers.set("transfer-encoding", "chunked");
    headers.delete("content-length");
    return { chunked: true };
}

function createBufferedConnWriter(dst: Destination, opts: Writers.Options) {
    const bufferSize = opts.highWaterMark ?? 16 * 1024;
    const directWriteThreshold = opts.directWriteThreshold ?? 64 * 1024;
    const bufWriter = new BufWriter(dst, bufferSize);

    const flush = async (): Promise<void> => {
        await bufWriter.flush();
    };

    const writeBytes = async (bytes: Uint8Array): Promise<void> => {
        if (bytes.length === 0) return;

        if (bytes.length >= directWriteThreshold) {
            await bufWriter.flush();
            await dst.write(bytes);
            return;
        }

        await bufWriter.write(bytes);
    };

    const writeRawString = async (str: string): Promise<void> => {
        if (str.length === 0) return;
        ioWrite.rawString(bufWriter, str);
    };

    return { flush, writeBytes, writeRawString, directWriteThreshold };
}

async function writeBody(
    dst: Destination,
    body: Exclude<PreparedBody, { kind: "none" }>,
    chunked: boolean,
    opts: Writers.Options,
    signal?: AbortSignal,
): Promise<void> {
    const bw = createBufferedConnWriter(dst, opts);

    const writeChunk = async (chunk: Uint8Array) => {
        if (signal?.aborted)
            throw signal.reason ?? new Error("Request aborted");

        if (!chunked) {
            await bw.writeBytes(chunk);
            return;
        }

        if (chunk.length === 0) return;

        await bw.writeRawString(chunk.length.toString(16));
        await bw.writeRawString(CRLF_STR);
        await bw.writeBytes(chunk);
        await bw.writeRawString(CRLF_STR);
    };

    if (body.kind === "bytes") {
        await writeChunk(body.bytes);
    } else {
        for await (const chunk of body.stream) {
            await writeChunk(chunk);
        }
    }

    if (chunked) {
        await bw.writeRawString(`0${CRLF_STR}${CRLF_STR}`);
    }

    await bw.flush();
}

async function writeCoalesced(
    dst: Destination,
    scratch: Bytes,
    head: RequestHead,
    bodyBytes: Uint8Array,
    chunked: boolean,
): Promise<void> {
    scratch.reset();
    encodeHead(scratch, head);

    if (!chunked) {
        ioWrite.bytes(scratch, bodyBytes);
        await dst.write(scratch.result());
        scratch.reset();
        return;
    }

    ioWrite.rawString(scratch, bodyBytes.length.toString(16));
    ioWrite.rawString(scratch, CRLF_STR);
    ioWrite.bytes(scratch, bodyBytes);
    ioWrite.rawString(scratch, `${CRLF_STR}0${CRLF_STR}${CRLF_STR}`);

    await dst.write(scratch.result());
    scratch.reset();
}

export function createRequestWriter(
    dst: Destination,
    opts: Writers.Options = {},
): Writers.Writer {
    const scratch = Bytes.alloc(opts.highWaterMark ?? 16 * 1024);

    const write = async (req: Writers.Request): Promise<void> => {
        if (req.signal?.aborted)
            throw req.signal.reason ?? new Error("Request aborted");

        const method = req.method.toUpperCase();
        const headers = req.headers ? new Headers(req.headers) : new Headers();
        const url = req.url;

        if (!headers.has("host")) headers.set("host", url.host);
        if (!headers.has("date")) headers.set("date", new Date().toUTCString());

        const target = toRequestTarget(url);

        let body = prepareBody(headers, req.body ?? null);

        const ceRaw = headers.get("content-encoding") ?? undefined;
        const ceEncoders = createEncoders(ceRaw);

        if (body.kind !== "none" && ceEncoders.length > 0) {
            const stream =
                body.kind === "stream"
                    ? body.stream
                    : bytesToStream(body.bytes);

            body = {
                kind: "stream",
                stream: encodeStream(stream, ceRaw) as ByteStream,
                length: null,
            };

            headers.delete("content-length");
        }

        const teInfo = parseTransferEncoding(headers);
        if (body.kind !== "none" && teInfo.has && teInfo.codings.length > 0) {
            const stream =
                body.kind === "stream"
                    ? body.stream
                    : bytesToStream(body.bytes);

            body = {
                kind: "stream",
                stream: encodeStream(stream, teInfo.codings) as ByteStream,
                length: null,
            };

            headers.delete("content-length");
        }

        const { chunked } = finalizeDelimitation(headers, body);

        const head: RequestHead = {
            method,
            target,
            headers,
        };

        if (body.kind === "bytes") {
            const max = opts.coalesceBodyMaxBytes ?? 64 * 1024;
            if (body.bytes.length <= max) {
                await writeCoalesced(dst, scratch, head, body.bytes, chunked);
                return;
            }
        }

        scratch.reset();
        encodeHead(scratch, head);
        await dst.write(scratch.result());
        scratch.reset();

        if (body.kind === "none") return;

        if (body.kind === "bytes" && !chunked) {
            if (req.signal?.aborted)
                throw req.signal.reason ?? new Error("Request aborted");
            await dst.write(body.bytes);
            return;
        }

        await writeBody(dst, body, chunked, opts, req.signal);
    };

    return { write };
}
