# Parsed codebase for the project: fetch


## Directory Structure
- fetch/
- fetch/src/
- fetch/src/io/
- fetch/src/io/io.ts (6320 bytes)
- fetch/src/io/_utils.ts (2374 bytes)
- fetch/src/io/readers.ts (23033 bytes)
- fetch/src/io/writers.ts (9264 bytes)
- fetch/src/io/buf-writer.ts (5356 bytes)
- fetch/src/types/
- fetch/src/types/agent.ts (4092 bytes)
- fetch/src/types/index.ts (51 bytes)
- fetch/src/types/dialer.ts (1043 bytes)
- fetch/src/dialers/
- fetch/src/dialers/tcp.ts (3886 bytes)
- fetch/src/dialers/index.ts (123 bytes)
- fetch/src/dialers/proxy.ts (3016 bytes)
- fetch/src/_internal/
- fetch/src/_internal/consts.ts (118 bytes)
- fetch/src/_internal/promises.ts (636 bytes)
- fetch/src/_internal/streams.ts (1517 bytes)
- fetch/src/_internal/net.ts (4608 bytes)
- fetch/src/_internal/guards.ts (2532 bytes)
- fetch/src/_internal/error-adapters.ts (9427 bytes)
- fetch/src/errors.ts (9876 bytes)
- fetch/src/agent.ts (11949 bytes)
- fetch/src/index.ts (225 bytes)
- fetch/src/encoding.ts (5633 bytes)
- fetch/src/agent-pool.ts (3821 bytes)
- fetch/src/http-client.ts (2025 bytes)
- fetch/src/body.ts (7796 bytes)
- fetch/src/fetch.ts (6476 bytes)
- fetch/examples/
- fetch/examples/simple.ts (170 bytes)
- fetch/tests/
- fetch/tests/agent-pool.test.ts (3402 bytes)
- fetch/tests/fetch.test.ts (9180 bytes)
- fetch/tests/agent.test.ts (4161 bytes)
- fetch/tests/errors.test.ts (5212 bytes)
- fetch/tests/io-options.test.ts (3565 bytes)
- fetch/tests/test-utils.ts (9117 bytes)
- fetch/README.md (0 bytes)
- fetch/package.json (972 bytes)
- fetch/tsconfig.json (848 bytes)
- fetch/bun.lock (4999 bytes)
- fetch/benchmarks/
- fetch/benchmarks/_infra.ts (3729 bytes)
- fetch/benchmarks/_clients.ts (20888 bytes)
- fetch/benchmarks/direct.ts (281 bytes)
- fetch/benchmarks/proxy.ts (297 bytes)
- fetch/benchmarks/index.ts (763 bytes)
- fetch/benchmarks/_runner.ts (4014 bytes)

## Summary
- Total files: 42
- Total directories: 8
- Total text file size (including ignored): 6197.13 KB
- Total tokens: 42733
- Analyzed text content size: 192.18 KB

Top largest non-ignored files:
- fetch/src/io/readers.ts (22.49 kB)
- fetch/benchmarks/_clients.ts (20.40 kB)
- fetch/src/agent.ts (11.67 kB)
- fetch/src/errors.ts (9.64 kB)
- fetch/src/_internal/error-adapters.ts (9.21 kB)
- fetch/src/io/writers.ts (9.05 kB)
- fetch/tests/fetch.test.ts (8.96 kB)
- fetch/tests/test-utils.ts (8.90 kB)
- fetch/src/body.ts (7.61 kB)
- fetch/src/fetch.ts (6.32 kB)

Top largest non-ignored directories:
- fetch/src (122.26 kB)
- fetch/src/io (45.26 kB)
- fetch/tests (33.83 kB)
- fetch/benchmarks (29.27 kB)
- fetch/src/_internal (18.40 kB)
- fetch/src/dialers (6.86 kB)
- fetch/src/types (5.06 kB)
- fetch/examples (0.17 kB)


## Ignore summary:
During the analysis, some files were ignored:
- No of files ignored during parsing: 1287
- Patterns used to ignore files: {'.git', '.DS_Store', 'venv', 'dist', '*.pyo', '*.log', '*.pyc', '.svn', '*.bak', 'Thumbs.db', 'build', '.vscode', '*.swp', '*.pyd', 'node_modules', '*.dll', '.gitignore', 'bower_components', '*.tmp', '__pycache__', '.venv', '*.dylib', 'env', '.idea', '*.so', '.hg', '*.egg-info'}

## Files:
### fetch/src/io/io.ts

```
import type { IReadable } from "@fuman/io";
import type { IConnection } from "@fuman/net";
import { MaxBytesTransformStream } from "../_internal/streams";
import { decodeStream } from "../encoding";
import {
    parseContentLength,
    parseMaxBytes,
    parseTransferEncoding,
    splitTokens,
} from "./_utils";
import {
    BodyReader,
    ChunkedBodyReader,
    LineReader,
    type Readers,
} from "./readers";
import { createRequestWriter, type Writers } from "./writers";

function parseStatusLine(line: string) {
    const m = /^HTTP\/(\d+)\.(\d+)\s+(\d{3})(?:\s+(.*))?$/.exec(line);
    if (!m) throw new Error(`Invalid HTTP status line: ${line}`);

    const major = Number(m[1]);
    const minor = Number(m[2]);
    const status = Number(m[3]);
    if (
        !Number.isFinite(major) ||
        !Number.isFinite(minor) ||
        !Number.isFinite(status)
    ) {
        throw new Error(`Invalid HTTP status line: ${line}`);
    }

    return { major, minor, status, statusText: m[4] ?? "" };
}

export async function readResponse(
    conn: IConnection<unknown>,
    options: Readers.Options & LineReader.ReadHeadersOptions = {},
    shouldIgnoreBody: (status: number) => boolean,
    onDone?: (reusable: boolean) => void,
): Promise<Response> {
    const lr = new LineReader(conn, options);

    const finalize = (() => {
        let called = false;
        return (reusable: boolean) => {
            if (called) return;
            called = true;
            queueMicrotask(() => onDone?.(reusable));
        };
    })();

    let statusLine!: {
        major: number;
        minor: number;
        status: number;
        statusText: string;
    };
    let headers!: Headers;

    for (;;) {
        const line = await lr.readLine();
        if (line === null)
            throw new Error("Unexpected EOF while reading status line");

        const parsed = parseStatusLine(line);
        const hdrs = await lr.readHeaders(options);

        if (parsed.status >= 100 && parsed.status < 200) {
            if (parsed.status === 101)
                throw new Error("HTTP/1.1 protocol upgrades not supported");
            continue;
        }

        statusLine = parsed;
        headers = hdrs;
        break;
    }

    const { major, minor, status, statusText } = statusLine;

    const connectionTokens = splitTokens(headers.get("connection"));
    const hasClose = connectionTokens.includes("close");
    const hasKeepAlive = connectionTokens.includes("keep-alive");

    const isHttp10 = major === 1 && minor === 0;
    const keepAliveOk = !isHttp10 || hasKeepAlive;

    const ignoreBody = shouldIgnoreBody(status);

    const te = parseTransferEncoding(headers);

    let chunked = false;
    let contentLength: number | null = null;

    if (!ignoreBody) {
        if (te.has) {
            chunked = te.chunked;
            contentLength = null;
            headers.delete("content-length");
        } else {
            chunked = false;
            contentLength = parseContentLength(headers);
        }
    }

    const bodyDelimited = ignoreBody || chunked || contentLength != null;
    const reusable = keepAliveOk && !hasClose && bodyDelimited;

    if (ignoreBody) {
        finalize(reusable);
        return new Response(null, { status, statusText, headers });
    }

    if (chunked) headers.delete("content-length");

    const reader: IReadable = chunked
        ? new ChunkedBodyReader(lr, options)
        : new BodyReader(lr, contentLength ?? -1, options);

    const rawBody = new ReadableStream<Uint8Array>({
        type: "bytes" as const,
        async pull(controller: ReadableByteStreamController) {
            const byob = controller.byobRequest;
            const view = byob?.view
                ? new Uint8Array(
                      byob.view.buffer,
                      byob.view.byteOffset,
                      byob.view.byteLength,
                  )
                : new Uint8Array(
                      new ArrayBuffer(options.highWaterMark ?? 16 * 1024),
                  );

            try {
                const n = await reader.read(view);
                if (n === 0) {
                    byob?.respond(0);
                    controller.close();
                    finalize(reusable);
                    return;
                }

                if (byob) byob.respond(n);
                else controller.enqueue(view.subarray(0, n));
            } catch (err) {
                controller.error(err);
                finalize(false);
            }
        },
        cancel() {
            finalize(false);
        },
    });

    let body: ReadableStream<Uint8Array> = rawBody;

    try {
        if (te.has && te.codings.length > 0) {
            const decodedTe = decodeStream(
                body,
                te.codings,
            ) as ReadableStream<Uint8Array>;
            if (decodedTe !== body) {
                if (te.chunked) headers.set("transfer-encoding", "chunked");
                else headers.delete("transfer-encoding");

                headers.delete("content-length");
            }
            body = decodedTe;
        }

        const decompress =
            (options as Readers.DecompressionOptions).decompress !== false;
        const contentEncoding = headers.get("content-encoding") ?? undefined;

        if (decompress && contentEncoding) {
            const decodedCe = decodeStream(
                body,
                contentEncoding,
            ) as ReadableStream<Uint8Array>;
            if (decodedCe !== body) {
                headers.delete("content-encoding");
                headers.delete("content-length");
            }
            body = decodedCe;
        }

        const maxDecoded = parseMaxBytes(
            (options as Readers.SizeLimitOptions).maxDecodedBodySize,
        );
        if (maxDecoded != null) {
            body = body.pipeThrough(new MaxBytesTransformStream(maxDecoded));
        }
    } catch (err) {
        finalize(false);
        throw err;
    }

    return new Response(body, { status, statusText, headers });
}

export async function writeRequest(
    conn: IConnection<unknown>,
    req: Writers.Request,
    options: Writers.Options = {},
): Promise<void> {
    const writer = createRequestWriter(conn, options);
    await writer.write(req);
}

```

### fetch/src/io/_utils.ts

```
import bytes from "bytes";

type TransferEncodingInfo = {
    has: boolean;
    chunked: boolean;
    codings: string[];
};

export function parseMaxBytes(value?: number | string): number | null {
    if (value === undefined) return null;

    if (typeof value === "number") {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error(`invalid max size: ${String(value)}`);
        }
        return Math.floor(value);
    }

    const parsed = bytes.parse(value);
    if (parsed == null || !Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`invalid max size: ${String(value)}`);
    }

    return parsed;
}

export function splitTokens(v: string | null): string[] {
    if (!v) return [];
    return v
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

export function parseTransferEncoding(headers: Headers): TransferEncodingInfo {
    const raw = headers.get("transfer-encoding");
    const tks = splitTokens(raw);
    if (tks.length === 0) return { has: false, chunked: false, codings: [] };

    const chunkedIdx = tks.lastIndexOf("chunked");
    const hasChunked = chunkedIdx !== -1;

    if (hasChunked && chunkedIdx !== tks.length - 1) {
        throw new Error(`Invalid transfer-encoding order: ${raw ?? ""}`);
    }

    if (hasChunked && tks.indexOf("chunked") !== chunkedIdx) {
        throw new Error(
            `Invalid transfer-encoding (duplicate chunked): ${raw ?? ""}`,
        );
    }

    const codings = tks.filter((t) => t !== "chunked" && t !== "identity");

    return { has: true, chunked: hasChunked, codings };
}

export function parseContentLength(headers: Headers): number | null {
    const raw = headers.get("content-length");
    if (!raw) return null;

    const parts = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    if (parts.length === 0) return null;

    let value: number | null = null;

    for (const p of parts) {
        if (!/^\d+$/.test(p)) throw new Error(`Invalid content-length: ${raw}`);
        const n = Number.parseInt(p, 10);
        if (!Number.isFinite(n) || n < 0)
            throw new Error(`Invalid content-length: ${raw}`);

        if (value === null) value = n;
        else if (value !== n)
            throw new Error(`Conflicting content-length values: ${raw}`);
    }

    return value;
}

```

### fetch/src/io/readers.ts

```
import type { IClosable, IReadable } from "@fuman/io";
import { Bytes, DelimiterCodec, read as ioRead } from "@fuman/io";
import { ConnectionClosedError } from "@fuman/net";
import { CRLF_BYTES } from "../_internal/consts";
import { parseMaxBytes } from "./_utils";

type Source = IReadable & IClosable;

// FROM https://github.com/denoland/deno/blob/b34628a26ab0187a827aa4ebe256e23178e25d39/cli/js/web/headers.ts#L9
const invalidHeaderCharRegex = /[^\t\x20-\x7e\x80-\xff]/g;

export function sanitizeHeaderValue(v: string): string {
    return v.replace(invalidHeaderCharRegex, (m) => encodeURI(m));
}

/**
 * Reader options shared across the HTTP/1 response pipeline.
 *
 * @namespace Readers
 */
export namespace Readers {
    /**
     * Buffering configuration.
     *
     * @property {number} [bufferSize] - Initial size (in bytes) for the internal buffer.
     *
     * @property {number} [highWaterMark] - Target read size (in bytes) for each pull from the underlying source.
     * Defaults to 16 KiB.
     */
    export interface BufferingOptions {
        bufferSize?: number;
        highWaterMark?: number;
    }

    /**
     * Response size limits.
     *
     * @property {number|string} [maxBodySize] - Maximum allowed entity-body size (raw, before content decoding).
     * Can be a number of bytes or a human-readable string like "10mb".
     *
     * @property {number|string} [maxDecodedBodySize] - Maximum allowed decoded body size (after content decoding).
     * Can be a number of bytes or a human-readable string like "10mb".
     */
    export interface SizeLimitOptions {
        maxBodySize?: number | string;
        maxDecodedBodySize?: number | string;
    }

    /**
     * Decompression behavior.
     *
     * @property {boolean} [decompress] - If true, the response body may be transparently decompressed based on
     * Content-Encoding. Defaults to true.
     */
    export interface DecompressionOptions {
        decompress?: boolean;
    }

    /**
     * Delimiter scanning limits.
     *
     * @property {number} [maxLineSize] - Maximum allowed bytes for a single CRLF-delimited line (excluding CRLF).
     * Defaults to 64 KiB.
     *
     * @property {number} [maxBufferedBytes] - Maximum allowed buffered bytes while searching for CRLF.
     * Defaults to 256 KiB.
     */
    export interface DelimiterLimitsOptions {
        maxLineSize?: number;
        maxBufferedBytes?: number;
    }

    /**
     * Unified options shape suitable for fetch-like response parsing.
     */
    export type Options = LineReader.Options &
        BodyReader.Options &
        ChunkedBodyReader.Options;
}

/* -------------------------------------------------------------------------- */
/*                               Line Reader                                  */
/* -------------------------------------------------------------------------- */

/**
 * CRLF-delimited reader that preserves over-reads in an internal buffer.
 *
 * Key property: once you finish reading headers, any bytes already read beyond
 * the header terminator stay buffered and will be returned by read().
 */
export class LineReader implements IReadable, IClosable {
    #src: Source;
    #buf: Bytes;
    #codec = new DelimiterCodec(CRLF_BYTES, { strategy: "discard" });
    #eof = false;
    #highWaterMark: number;
    #maxBufferedBytes: number;
    #maxLineSize: number;
    #closed = false;

    close: () => Promise<void> | void;

    /**
     * LineReader configuration.
     *
     * @namespace LineReader
     */
    static Options: never;

    constructor(src: Source, opts: LineReader.Options = {}) {
        this.#src = src;
        this.#buf = Bytes.alloc(opts.bufferSize);
        this.#highWaterMark = opts.highWaterMark ?? 16 * 1024;
        this.#maxBufferedBytes = opts.maxBufferedBytes ?? 256 * 1024;
        this.#maxLineSize = opts.maxLineSize ?? 64 * 1024;
        this.close = this.#close.bind(this);
    }

    async read(into: Uint8Array): Promise<number> {
        if (this.#closed) return 0;

        if (this.#buf.available > 0) {
            const n = Math.min(into.length, this.#buf.available);
            into.set(this.#buf.readSync(n));
            this.#buf.reclaim();
            return n;
        }

        if (this.#eof) return 0;

        try {
            return await this.#src.read(into);
        } catch (e) {
            if (e instanceof ConnectionClosedError) {
                this.#eof = true;
                return 0;
            }
            throw e;
        }
    }

    async readLine(): Promise<string | null> {
        if (this.#closed) return null;

        for (;;) {
            const frame = this.#codec.decode(this.#buf, this.#eof);
            if (frame !== null) {
                this.#buf.reclaim();
                return ioRead.rawString(frame, frame.length);
            }

            if (this.#eof) return null;

            if (this.#buf.available > this.#maxLineSize) {
                throw new Error(
                    `line too large (> ${this.#maxLineSize} bytes)`,
                );
            }

            if (this.#buf.available > this.#maxBufferedBytes) {
                throw new Error(
                    `buffer too large while searching for delimiter (> ${this.#maxBufferedBytes} bytes)`,
                );
            }

            await this.#pull();
        }
    }

    async readHeaders(
        opts: LineReader.ReadHeadersOptions = {},
    ): Promise<Headers> {
        const maxHeaderSize = opts.maxHeaderSize ?? 64 * 1024;

        const acc = new Map<string, string[]>();
        const validator = new Headers();

        let lastKey: string | null = null;
        let firstLine = true;
        let consumed = 0;

        for (;;) {
            const line = await this.readLine();
            if (line === null) {
                throw new Error("Unexpected EOF while reading HTTP headers");
            }

            consumed += line.length + 2;
            if (consumed > maxHeaderSize) {
                throw new Error(
                    `HTTP headers too large (> ${maxHeaderSize} bytes)`,
                );
            }

            if (line === "") break;

            if (firstLine && (line[0] === " " || line[0] === "\t")) {
                throw new Error(`malformed HTTP header initial line: ${line}`);
            }
            firstLine = false;

            if (line[0] === " " || line[0] === "\t") {
                if (!lastKey) {
                    throw new Error(
                        `malformed HTTP header continuation line: ${line}`,
                    );
                }
                const arr = acc.get(lastKey);
                if (!arr || arr.length === 0) {
                    throw new Error(
                        `malformed HTTP header continuation line: ${line}`,
                    );
                }
                const piece = sanitizeHeaderValue(line.trim());
                arr[arr.length - 1] = `${arr[arr.length - 1]} ${piece}`.trim();
                continue;
            }

            const idx = line.indexOf(":");
            if (idx === -1) {
                throw new Error(`malformed HTTP header line: ${line}`);
            }

            const rawName = line.slice(0, idx).trim();
            if (rawName === "") {
                lastKey = null;
                continue;
            }

            const name = rawName.toLowerCase();
            const value = sanitizeHeaderValue(line.slice(idx + 1).trim());

            try {
                validator.append(name, value);
            } catch {
                lastKey = null;
                continue;
            }

            const arr = acc.get(name);
            if (arr) arr.push(value);
            else acc.set(name, [value]);

            lastKey = name;
        }

        const headers = new Headers();
        for (const [k, values] of acc) {
            for (const v of values) {
                try {
                    headers.append(k, v);
                } catch {}
            }
        }
        return headers;
    }

    async #pull(): Promise<void> {
        const into = this.#buf.writeSync(this.#highWaterMark);
        try {
            const n = await this.#src.read(into);
            this.#buf.disposeWriteSync(n);
            if (n === 0) this.#eof = true;
        } catch (e) {
            this.#buf.disposeWriteSync(0);
            if (e instanceof ConnectionClosedError) {
                this.#eof = true;
                return;
            }
            throw e;
        } finally {
            this.#buf.reclaim();
        }
    }

    async #close(): Promise<void> {
        if (this.#closed) return;
        this.#closed = true;
        try {
            await this.#src.close();
        } finally {
            this.#closed = true;
        }
    }
}

/**
 * LineReader configuration.
 *
 * @namespace LineReader
 */
export namespace LineReader {
    /**
     * LineReader instance options.
     *
     * @property {number} [bufferSize] - Initial size (in bytes) for the internal buffer.
     *
     * @property {number} [highWaterMark] - Target read size (in bytes) for each pull from the underlying source.
     * Defaults to 16 KiB.
     *
     * @property {number} [maxLineSize] - Maximum allowed bytes for a single CRLF-delimited line (excluding CRLF).
     * Defaults to 64 KiB.
     *
     * @property {number} [maxBufferedBytes] - Maximum allowed buffered bytes while searching for CRLF.
     * Defaults to 256 KiB.
     */
    export interface Options
        extends Readers.BufferingOptions,
            Readers.DelimiterLimitsOptions {}

    /**
     * Header parsing limits.
     *
     * @property {number} [maxHeaderSize] - Maximum allowed bytes for all header fields (including CRLFs).
     * Defaults to 64 KiB.
     */
    export interface ReadHeadersOptions {
        maxHeaderSize?: number;
    }
}

/* -------------------------------------------------------------------------- */
/*                               Body Reader                                  */
/* -------------------------------------------------------------------------- */

/**
 * Body reader that streams bytes with either a fixed Content-Length or until EOF.
 */
export class BodyReader implements IReadable, IClosable {
    #src: Source;
    #remaining: number | null;
    #maxResponseSize: number | null;
    #readSoFar = 0;
    #closed = false;

    close: () => Promise<void> | void;

    /**
     * BodyReader configuration.
     *
     * @namespace BodyReader
     */
    static Options: never;

    constructor(
        src: Source,
        contentLength: number,
        opts: BodyReader.Options = {},
    ) {
        this.#src = src;
        this.#remaining = contentLength >= 0 ? contentLength : null;
        this.#maxResponseSize = parseMaxBytes(opts.maxBodySize);

        if (
            this.#maxResponseSize != null &&
            this.#remaining != null &&
            this.#remaining > this.#maxResponseSize
        ) {
            throw new Error(
                `body too large: content-length=${this.#remaining} > maxResponseSize=${this.#maxResponseSize}`,
            );
        }

        this.close = this.#close.bind(this);
    }

    async read(into: Uint8Array): Promise<number> {
        if (this.#closed) return 0;
        if (this.#remaining === 0) return 0;

        let max = into.length;

        if (this.#remaining != null) {
            max = Math.min(max, this.#remaining);
        }

        if (this.#maxResponseSize != null) {
            const remainingLimit = this.#maxResponseSize - this.#readSoFar;
            if (remainingLimit <= 0) {
                throw new Error(
                    `body too large (> ${this.#maxResponseSize} bytes)`,
                );
            }
            max = Math.min(max, remainingLimit);
        }

        if (max === 0) return 0;

        const view = max === into.length ? into : into.subarray(0, max);

        let n = 0;
        try {
            n = await this.#src.read(view);
        } catch (e) {
            if (e instanceof ConnectionClosedError) n = 0;
            else throw e;
        }

        if (n === 0) {
            if (this.#remaining != null) {
                throw new Error(
                    "Unexpected EOF while reading fixed-length body",
                );
            }
            return 0;
        }

        this.#readSoFar += n;
        if (this.#remaining != null) this.#remaining -= n;

        return n;
    }

    async #close(): Promise<void> {
        if (this.#closed) return;
        this.#closed = true;
        try {
            await this.#src.close();
        } finally {
            this.#closed = true;
        }
    }
}

/**
 * BodyReader configuration.
 *
 * @namespace BodyReader
 */
export namespace BodyReader {
    /**
     * BodyReader instance options.
     *
     * @property {number|string} [maxBodySize] - Maximum allowed entity-body size (raw, before content decoding).
     * Can be a number of bytes or a human-readable string like "10mb".
     *
     * @property {number|string} [maxDecodedBodySize] - Maximum allowed decoded body size (after content decoding).
     * Can be a number of bytes or a human-readable string like "10mb".
     *
     * @property {boolean} [decompress] - If true, the response body may be transparently decompressed based on
     * Content-Encoding. Defaults to true.
     */
    export interface Options
        extends Readers.SizeLimitOptions,
            Readers.DecompressionOptions {}
}

/* -------------------------------------------------------------------------- */
/*                          Chunked Body Reader                               */
/* -------------------------------------------------------------------------- */

/**
 * RFC 7230 chunked transfer-coding decoder.
 */
export class ChunkedBodyReader implements IReadable, IClosable {
    #src: Source;
    #buf: Bytes;
    #codec = new DelimiterCodec(CRLF_BYTES, { strategy: "discard" });

    #highWaterMark: number;
    #maxLineSize: number;
    #maxChunkSize: number;
    #maxResponseSize: number | null;

    #readSoFar = 0;
    #eof = false;
    #closed = false;

    #state:
        | { kind: "size" }
        | { kind: "data"; remaining: number }
        | { kind: "crlf" }
        | { kind: "trailers" }
        | { kind: "done" } = { kind: "size" };

    close: () => Promise<void> | void;

    /**
     * ChunkedBodyReader configuration.
     *
     * @namespace ChunkedBodyReader
     */
    static Options: never;

    constructor(src: Source, opts: ChunkedBodyReader.Options = {}) {
        this.#src = src;
        this.#buf = Bytes.alloc(opts.bufferSize);
        this.#highWaterMark = opts.highWaterMark ?? 16 * 1024;
        this.#maxLineSize = opts.maxLineSize ?? 64 * 1024;
        this.#maxChunkSize = opts.maxChunkSize ?? 16 * 1024 * 1024;
        this.#maxResponseSize = parseMaxBytes(opts.maxBodySize);
        this.close = this.#close.bind(this);
    }

    async read(into: Uint8Array): Promise<number> {
        if (this.#closed) return 0;

        for (;;) {
            if (this.#state.kind === "done") return 0;

            let view = into;

            if (this.#maxResponseSize != null) {
                const remainingLimit = this.#maxResponseSize - this.#readSoFar;
                if (remainingLimit <= 0) {
                    throw new Error(
                        `body too large (> ${this.#maxResponseSize} bytes)`,
                    );
                }
                if (view.length > remainingLimit)
                    view = view.subarray(0, remainingLimit);
            }

            if (view.length === 0) return 0;

            if (this.#state.kind === "data") {
                if (this.#state.remaining === 0) {
                    this.#state = { kind: "crlf" };
                    continue;
                }

                if (this.#buf.available > 0) {
                    const n = Math.min(
                        view.length,
                        this.#state.remaining,
                        this.#buf.available,
                    );
                    view.set(this.#buf.readSync(n));
                    this.#buf.reclaim();

                    this.#readSoFar += n;
                    this.#state = {
                        kind: "data",
                        remaining: this.#state.remaining - n,
                    };
                    return n;
                }

                const max = Math.min(view.length, this.#state.remaining);
                const slice =
                    max === view.length ? view : view.subarray(0, max);

                const n = await this.#readFromSrc(slice);
                if (n === 0) {
                    throw new Error(
                        "Unexpected EOF while reading chunked body",
                    );
                }

                this.#readSoFar += n;
                this.#state = {
                    kind: "data",
                    remaining: this.#state.remaining - n,
                };
                return n;
            }

            if (this.#state.kind === "size") {
                const line = await this.#readLine();
                if (line === null) {
                    throw new Error("Unexpected EOF while reading chunk size");
                }

                const semi = line.indexOf(";");
                const token = (semi === -1 ? line : line.slice(0, semi)).trim();
                if (token === "") {
                    throw new Error(`invalid chunk size line: ${line}`);
                }

                const size = Number.parseInt(token, 16);
                if (!Number.isFinite(size) || Number.isNaN(size) || size < 0) {
                    throw new Error(`invalid chunk size: ${token}`);
                }

                if (size > this.#maxChunkSize) {
                    throw new Error(
                        `chunk too large (> ${this.#maxChunkSize} bytes)`,
                    );
                }

                if (this.#maxResponseSize != null) {
                    const remainingLimit =
                        this.#maxResponseSize - this.#readSoFar;
                    if (size > remainingLimit) {
                        throw new Error(
                            `body too large (> ${this.#maxResponseSize} bytes)`,
                        );
                    }
                }

                this.#state =
                    size === 0
                        ? { kind: "trailers" }
                        : { kind: "data", remaining: size };
                continue;
            }

            if (this.#state.kind === "crlf") {
                await this.#consumeCrlf();
                this.#state = { kind: "size" };
                continue;
            }

            if (this.#state.kind === "trailers") {
                for (;;) {
                    const line = await this.#readLine();
                    if (line === null) {
                        throw new Error(
                            "Unexpected EOF while reading chunked trailers",
                        );
                    }
                    if (line === "") {
                        this.#state = { kind: "done" };
                        return 0;
                    }
                }
            }
        }
    }

    async #readFromSrc(into: Uint8Array): Promise<number> {
        if (this.#eof) return 0;

        try {
            const n = await this.#src.read(into);
            if (n === 0) this.#eof = true;
            return n;
        } catch (e) {
            if (e instanceof ConnectionClosedError) {
                this.#eof = true;
                return 0;
            }
            throw e;
        }
    }

    async #pull(): Promise<void> {
        const into = this.#buf.writeSync(this.#highWaterMark);
        try {
            const n = await this.#readFromSrc(into);
            this.#buf.disposeWriteSync(n);
        } catch (e) {
            this.#buf.disposeWriteSync(0);
            if (e instanceof ConnectionClosedError) {
                this.#eof = true;
                return;
            }
            throw e;
        } finally {
            this.#buf.reclaim();
        }
    }

    async #readLine(): Promise<string | null> {
        for (;;) {
            const frame = this.#codec.decode(this.#buf, this.#eof);
            if (frame !== null) {
                this.#buf.reclaim();
                return ioRead.rawString(frame, frame.length);
            }

            if (this.#eof) return null;

            if (this.#buf.available > this.#maxLineSize) {
                throw new Error(
                    `chunk line too large (> ${this.#maxLineSize} bytes)`,
                );
            }

            await this.#pull();
        }
    }

    async #consumeCrlf(): Promise<void> {
        while (this.#buf.available < 2) {
            if (this.#eof) {
                throw new Error(
                    "Unexpected EOF while reading chunk terminator",
                );
            }
            await this.#pull();
        }

        const two = this.#buf.readSync(2);
        this.#buf.reclaim();

        if (two[0] !== CRLF_BYTES[0] || two[1] !== CRLF_BYTES[1]) {
            throw new Error(
                "Invalid chunked encoding: missing CRLF after chunk data",
            );
        }
    }

    async #close(): Promise<void> {
        if (this.#closed) return;
        this.#closed = true;
        try {
            await this.#src.close();
        } finally {
            this.#closed = true;
        }
    }
}

/**
 * ChunkedBodyReader configuration.
 *
 * @namespace ChunkedBodyReader
 */
export namespace ChunkedBodyReader {
    /**
     * ChunkedBodyReader instance options.
     *
     * @property {number|string} [maxBodySize] - Maximum allowed entity-body size (raw, before content decoding).
     * Can be a number of bytes or a human-readable string like "10mb".
     *
     * @property {number|string} [maxDecodedBodySize] - Maximum allowed decoded body size (after content decoding).
     * Can be a number of bytes or a human-readable string like "10mb".
     *
     * @property {boolean} [decompress] - If true, the response body may be transparently decompressed based on
     * Content-Encoding. Defaults to true.
     *
     * @property {number} [bufferSize] - Initial size (in bytes) for the internal buffer.
     *
     * @property {number} [highWaterMark] - Target read size (in bytes) for each pull from the underlying source.
     * Defaults to 16 KiB.
     *
     * @property {number} [maxLineSize] - Maximum allowed bytes for CRLF-delimited chunk control lines.
     * Defaults to 64 KiB.
     *
     * @property {number} [maxChunkSize] - Maximum allowed bytes for any single chunk.
     * Defaults to 16 MiB.
     */
    export interface Options
        extends BodyReader.Options,
            Readers.BufferingOptions {
        maxLineSize?: number;
        maxChunkSize?: number;
    }
}

```

### fetch/src/io/writers.ts

```
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

```

### fetch/src/io/buf-writer.ts

```
import type { ISyncWritable, IWritable } from "@fuman/io";
import { u8 } from "@fuman/utils";

const DEFAULT_BUF_SIZE = 4096;
const MIN_BUF_SIZE = 16;

export class BufWriter implements IWritable, ISyncWritable {
    #buffer: Uint8Array;
    #writable: IWritable;

    #writePos = 0;
    #error: Error | null = null;

    #pending: Uint8Array[] = [];
    #pendingBytes = 0;

    #lastWrite: { buf: Uint8Array; size: number; internal: boolean } | null =
        null;

    constructor(writable: IWritable, size: number = DEFAULT_BUF_SIZE) {
        if (size < MIN_BUF_SIZE) size = MIN_BUF_SIZE;
        this.#buffer = u8.alloc(size);
        this.#writable = writable;
    }

    get bufferSize(): number {
        return this.#buffer.byteLength;
    }

    get buffered(): number {
        return this.#pendingBytes + this.#writePos;
    }

    get available(): number {
        return this.#buffer.byteLength - this.#writePos;
    }

    reset(writable: IWritable): void {
        this.#error = null;
        this.#writePos = 0;
        this.#pending.length = 0;
        this.#pendingBytes = 0;
        this.#lastWrite = null;
        this.#writable = writable;
    }

    writeSync(bytes: number): Uint8Array {
        if (this.#error) throw this.#error;
        if (bytes < 0) throw new RangeError("bytes must be >= 0");
        if (this.#lastWrite)
            throw new Error(
                "disposeWriteSync must be called before the next writeSync",
            );

        if (bytes === 0) {
            const empty = this.#buffer.subarray(this.#writePos, this.#writePos);
            this.#lastWrite = { buf: empty, size: 0, internal: true };
            return empty;
        }

        if (bytes > this.available && this.#writePos > 0) {
            const copy = u8.allocWith(this.#buffer.subarray(0, this.#writePos));
            this.#pending.push(copy);
            this.#pendingBytes += copy.length;
            this.#writePos = 0;
        }

        if (bytes <= this.#buffer.byteLength) {
            if (bytes > this.available) {
                const copy = u8.allocWith(
                    this.#buffer.subarray(0, this.#writePos),
                );
                this.#pending.push(copy);
                this.#pendingBytes += copy.length;
                this.#writePos = 0;
            }

            const start = this.#writePos;
            const end = start + bytes;
            const slice = this.#buffer.subarray(start, end);
            this.#writePos = end;
            this.#lastWrite = { buf: slice, size: bytes, internal: true };
            return slice;
        }

        const chunk = u8.alloc(bytes);
        this.#lastWrite = { buf: chunk, size: bytes, internal: false };
        return chunk;
    }

    disposeWriteSync(written?: number): void {
        const lw = this.#lastWrite;
        if (!lw) return;

        const w = written ?? lw.size;
        if (w < 0 || w > lw.size) {
            throw new RangeError(`written out of bounds: ${w} (0..${lw.size})`);
        }

        if (lw.internal) {
            this.#writePos -= lw.size - w;
        } else {
            if (w > 0) {
                const chunk = w === lw.size ? lw.buf : lw.buf.subarray(0, w);
                this.#pending.push(chunk);
                this.#pendingBytes += chunk.length;
            }
        }

        this.#lastWrite = null;
    }

    async #flushPending(): Promise<void> {
        if (this.#error) throw this.#error;
        if (this.#lastWrite)
            throw new Error(
                "disposeWriteSync must be called before flush/write",
            );

        while (this.#pending.length > 0) {
            const chunk = this.#pending[0];
            try {
                await this.#writable.write(chunk);
            } catch (e) {
                this.#error = e as Error;
                throw e;
            }
            this.#pending.shift();
            this.#pendingBytes -= chunk.length;
        }
    }

    async flush(): Promise<void> {
        await this.#flushPending();
        if (this.#error) throw this.#error;
        if (this.#writePos === 0) return;

        try {
            await this.#writable.write(
                this.#buffer.subarray(0, this.#writePos),
            );
        } catch (e) {
            this.#error = e as Error;
            throw e;
        }

        this.#writePos = 0;
    }

    async write(bytes: Uint8Array): Promise<void> {
        if (this.#error) throw this.#error;
        if (!bytes.length) return;

        await this.#flushPending();

        if (this.#writePos === 0 && bytes.length >= this.#buffer.byteLength) {
            try {
                await this.#writable.write(bytes);
            } catch (e) {
                this.#error = e as Error;
                throw e;
            }
            return;
        }

        let off = 0;
        while (off < bytes.length) {
            if (this.available === 0) {
                await this.flush();
                continue;
            }

            const toCopy = Math.min(this.available, bytes.length - off);
            this.#buffer.set(bytes.subarray(off, off + toCopy), this.#writePos);
            this.#writePos += toCopy;
            off += toCopy;

            if (this.#writePos === this.#buffer.byteLength) {
                await this.flush();
            }
        }
    }
}

```

### fetch/src/types/agent.ts

```
import type { BodyInit } from "../body";
import type { LineReader, Readers } from "../io/readers";
import type { Writers } from "../io/writers";
import type { Dialer } from "./dialer";

export interface Agent {
    [Symbol.dispose](): void;
    close(): void;

    readonly hostname: string;
    readonly port: number;

    send(options: Agent.SendOptions): Promise<Response>;
    whenIdle(): Promise<void>;

    readonly isIdle: boolean;
    readonly lastUsed: number;
}

export namespace Agent {
    export interface ConnectOptions {
        /** Connection timeout (ms) used only while establishing the socket. */
        timeout?: number;

        /**
         * Configure SO_KEEPALIVE on the underlying connection.
         *
         * - `true` / `false`: explicitly set the flag
         * - `null`: do not touch the runtime default
         */
        keepAlive?: boolean | null;

        /**
         * Configure TCP_NODELAY on the underlying connection.
         *
         * This is a connection-level option only; it is not related to HTTP body
         * buffering or writer coalescing.
         */
        noDelay?: boolean;
    }

    /**
     * Reader options currently supported by the low-level HTTP response parser.
     *
     * These options are applied per-agent / per-pool, not per-request.
     */
    export type ReaderOptions = Readers.Options & LineReader.ReadHeadersOptions;

    /**
     * Writer options currently supported by the low-level HTTP request writer.
     *
     * These options are applied per-agent / per-pool, not per-request.
     */
    export type WriterOptions = Writers.Options;

    /**
     * High-level HTTP I/O configuration forwarded to the low-level Readers/Writers.
     */
    export interface IOOptions {
        reader?: ReaderOptions;
        writer?: WriterOptions;
    }

    /**
     * Complete agent-level configuration.
     *
     * `connect` controls socket establishment behavior.
     * `io` controls HTTP reader/writer behavior.
     */
    export interface Options {
        connect?: ConnectOptions;
        io?: IOOptions;
    }

    export interface SendOptions {
        /**
         * Absolute request URL.
         *
         * Relative URLs are not supported at this layer.
         */
        url: string | URL;

        /**
         * HTTP method.
         *
         * The implementation may normalize casing before serialization.
         */
        method: string;

        /**
         * Pre-normalized headers for the low-level send path.
         *
         * Use `normalizeHeaders(...)` from the fetch layer when starting from a
         * generic `HeadersInit`.
         */
        headers?: Headers;

        body?: BodyInit | null;
        signal?: AbortSignal;
    }
}

export interface AgentPool {
    [Symbol.asyncDispose](): Promise<void>;
    close(): Promise<void>;

    readonly hostname: string;
    readonly port: number;

    send(options: Agent.SendOptions): Promise<Response>;
}

export namespace AgentPool {
    export interface Options {
        dialer?: Dialer;

        poolMaxIdlePerHost?: number;
        poolMaxPerHost?: number;

        /** `false` disables idle eviction. Defaults are handled by the implementation. */
        poolIdleTimeout?: number | false;

        /**
         * Publicly exposed socket/connection options.
         */
        connect?: Agent.ConnectOptions;

        /**
         * Publicly exposed HTTP I/O options forwarded to Readers/Writers.
         *
         * These are client/pool/agent-level settings, not per-request options.
         */
        io?: Agent.IOOptions;
    }
}

/** Back-compat */
export interface AgentConnectOptions extends Agent.ConnectOptions {}
/** Back-compat */
export interface AgentPoolOptions extends AgentPool.Options {}
/** Back-compat */
export interface SendOptions extends Agent.SendOptions {}
/** Back-compat */
export interface AgentIOOptions extends Agent.IOOptions {}
/** Back-compat */
export type AgentReaderOptions = Agent.ReaderOptions;
/** Back-compat */
export type AgentWriterOptions = Agent.WriterOptions;

```

### fetch/src/types/index.ts

```
export * from "./agent";
export * from "./dialer";

```

### fetch/src/types/dialer.ts

```
import type { ITcpConnection, ITlsConnection } from "@fuman/net";
import type { NodeTlsConnectOptions } from "@fuman/node";

export interface Dialer {
    dial(
        target: Dialer.Target,
        options?: Dialer.Options,
    ): Promise<Dialer.ConnectionLike>;
}

export namespace Dialer {
    export type ConnectionLike = ITcpConnection | ITlsConnection;

    export interface Target {
        address: string;
        port: number;
        secure: boolean;

        /** Server Name Indication (TLS). Defaults to the host when applicable. */
        sni?: string;

        /** Defaults to ["http/1.1"] when omitted by the dialer implementation. */
        alpnProtocols?: string[];

        /** Extra Node.js TLS options (minVersion, servername, etc.). */
        extraOptions?: NodeTlsConnectOptions["extraOptions"];
    }

    export interface Options {
        signal?: AbortSignal;
    }
}

/** Back-compat */
export type ConnectionLike = Dialer.ConnectionLike;
/** Back-compat */
export interface DialTarget extends Dialer.Target {}

```

### fetch/src/dialers/tcp.ts

```
import type { NodeTlsConnectOptions } from "@fuman/node";
import { connectTcp, connectTls } from "../_internal/net";
import type { Dialer } from "../types/dialer";

const DEFAULT_TCP_PORT = 80;
const DEFAULT_TLS_PORT = 443;
const DEFAULT_HTTP_ALPN_PROTOCOLS = ["http/1.1"] as const;

type HostPort = {
    address: string;
    port: number;
};

function parsePort(value: string | number): number {
    if (typeof value === "number") {
        if (!Number.isInteger(value) || value <= 0 || value > 65535) {
            throw new TypeError(`Invalid port: ${String(value)}`);
        }

        return value;
    }

    if (!/^\d+$/.test(value)) {
        throw new TypeError(`Invalid port: ${JSON.stringify(value)}`);
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        throw new TypeError(`Invalid port: ${JSON.stringify(value)}`);
    }

    return parsed;
}

export function resolveHostPort(
    target: URL | Dialer.Target,
    defaultPort: number,
): HostPort {
    const address = target instanceof URL ? target.hostname : target.address;

    if (!address) {
        throw new TypeError("Target address is required");
    }

    const port =
        target instanceof URL
            ? parsePort(target.port || String(defaultPort))
            : parsePort(target.port || defaultPort);

    return { address, port };
}

export class TcpDialer implements Dialer {
    async dial(
        target: Dialer.Target,
        options: Dialer.Options = {},
    ): Promise<Dialer.ConnectionLike> {
        if (target.secure) {
            throw new Error("TcpDialer cannot dial a secure target");
        }

        const endpoint = resolveHostPort(target, DEFAULT_TCP_PORT);

        return connectTcp({
            ...endpoint,
            signal: options.signal,
        });
    }
}

export class TlsDialer implements Dialer {
    readonly #options: Readonly<TlsDialer.Options>;

    constructor(options: TlsDialer.Options = {}) {
        this.#options = { ...options };
    }

    async dial(
        target: Dialer.Target,
        options: Dialer.Options = {},
    ): Promise<Dialer.ConnectionLike> {
        if (!target.secure) {
            throw new Error("TlsDialer cannot dial an insecure target");
        }

        const endpoint = resolveHostPort(target, DEFAULT_TLS_PORT);
        const extraOptions =
            this.#options.extraOptions || target.extraOptions
                ? {
                      ...this.#options.extraOptions,
                      ...target.extraOptions,
                  }
                : undefined;

        return connectTls({
            ...endpoint,
            signal: options.signal,
            caCerts: this.#options.caCerts,
            sni: target.sni ?? this.#options.sni ?? endpoint.address,
            alpnProtocols: target.alpnProtocols ??
                this.#options.alpnProtocols ?? [...DEFAULT_HTTP_ALPN_PROTOCOLS],
            extraOptions,
        });
    }
}

export namespace TlsDialer {
    export interface Options {
        caCerts?: string[];
        sni?: string;
        alpnProtocols?: string[];
        extraOptions?: NodeTlsConnectOptions["extraOptions"];
    }
}

export class AutoDialer implements Dialer {
    readonly tcpDialer: TcpDialer;
    readonly tlsDialer: TlsDialer;

    constructor(options: AutoDialer.Options = {}) {
        this.tcpDialer = options.tcp ?? new TcpDialer();
        this.tlsDialer = options.tls ?? new TlsDialer();
    }

    dial(
        target: Dialer.Target,
        options: Dialer.Options = {},
    ): Promise<Dialer.ConnectionLike> {
        return target.secure
            ? this.tlsDialer.dial(target, options)
            : this.tcpDialer.dial(target, options);
    }
}

export namespace AutoDialer {
    export interface Options {
        tcp?: TcpDialer;
        tls?: TlsDialer;
    }
}

```

### fetch/src/dialers/index.ts

```
export type { ConnectionLike, Dialer, DialTarget } from "../types/dialer";
export * from "./proxy";
export * from "./tcp";

```

### fetch/src/dialers/proxy.ts

```
import type { ITcpConnection } from "@fuman/net";
import type { NodeTlsUpgradeOptions } from "@fuman/node";
import {
    createProxyConnection,
    type ProxyConnectionFn,
    type ProxyInfo,
    parse as parseProxy,
} from "@npy/proxy-kit";
import { connectTcp, upgradeTls } from "../_internal/net";
import type { Dialer } from "../types/dialer";

const DEFAULT_HTTP_ALPN_PROTOCOLS = ["http/1.1"] as const;

type ProxyConnectOptions = Parameters<typeof connectTcp>[0];
type UpgradableTcpConnection = Parameters<typeof upgradeTls>[0];

function normalizeProxy(proxy: ProxyDialer.Input): ProxyDialer.Proxy {
    if (typeof proxy !== "string") {
        return proxy;
    }

    const parsed = parseProxy(proxy, { strict: true });
    if (parsed == null) {
        throw new TypeError(`Invalid proxy string: ${proxy}`);
    }

    return parsed;
}

export class ProxyDialer implements Dialer {
    readonly proxy: ProxyDialer.Proxy;
    readonly #options: Readonly<ProxyDialer.Options>;
    readonly #connectThroughProxy: ProxyConnectionFn<ProxyConnectOptions>;

    constructor(proxy: ProxyDialer.Input, options: ProxyDialer.Options = {}) {
        this.proxy = normalizeProxy(proxy);
        this.#options = { ...options };
        this.#connectThroughProxy = createProxyConnection({
            proxy: this.proxy,
            connectionFn: connectTcp,
        });
    }

    async dial(
        target: Dialer.Target,
        options: Dialer.Options = {},
    ): Promise<Dialer.ConnectionLike> {
        const tunneled = await this.#connectThroughProxy({
            address: target.address,
            port: target.port,
            signal: options.signal,
        });

        if (!target.secure) {
            return tunneled;
        }

        return this.#upgradeSecureTarget(tunneled, target, options.signal);
    }

    async #upgradeSecureTarget(
        conn: ITcpConnection,
        target: Dialer.Target,
        signal?: AbortSignal,
    ): Promise<Dialer.ConnectionLike> {
        const sni = target.sni ?? this.#options.sni ?? target.address;
        const extraOptions =
            this.#options.extraOptions || target.extraOptions
                ? { ...this.#options.extraOptions, ...target.extraOptions }
                : undefined;

        const tlsOptions: NodeTlsUpgradeOptions & { signal?: AbortSignal } = {
            signal,
            caCerts: this.#options.caCerts,
            sni,
            alpnProtocols: target.alpnProtocols ??
                this.#options.alpnProtocols ?? [...DEFAULT_HTTP_ALPN_PROTOCOLS],
            extraOptions,
        };

        return upgradeTls(conn as UpgradableTcpConnection, tlsOptions);
    }
}

export namespace ProxyDialer {
    export type Proxy = Parameters<typeof createProxyConnection>[0]["proxy"];

    export type Input = string | Proxy | ProxyInfo;

    export interface Options {
        caCerts?: string[];
        sni?: string;
        alpnProtocols?: string[];
        extraOptions?: NodeTlsUpgradeOptions["extraOptions"];
    }
}

```

### fetch/src/_internal/consts.ts

```
export const CRLF_BYTES = new Uint8Array([0x0d, 0x0a]);
export const CRLF_STR = "\r\n";
export const CRLF_LENGTH = 2;

```

### fetch/src/_internal/promises.ts

```
export function raceSignal<T>(
    promise: PromiseLike<T>,
    signal: AbortSignal,
): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => {
            function onAbort() {
                reject(signal.reason);
            }
            if (signal.aborted) {
                onAbort();
            } else {
                signal.addEventListener("abort", onAbort, { once: true });
                function cleanup() {
                    signal.removeEventListener("abort", onAbort);
                }
                promise.then(cleanup, cleanup);
            }
        }),
    ]);
}

```

### fetch/src/_internal/streams.ts

```
/**
 * Create a ReadableStream from a Uint8Array.
 *
 * The stream will emit the entire byte array as a single chunk,
 * then close immediately.
 *
 * @param bytes - The byte array to wrap.
 * @returns A ReadableStream that emits the bytes.
 */
export function bytesToStream(bytes: Uint8Array) {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(bytes);
            controller.close();
        },
    });
}

/**
 * A TransformStream that limits the total number of bytes passed through.
 *
 * It accumulates the byte count from incoming chunks and enqueues them
 * if the total remains within the limit; otherwise, it errors.
 *
 * @param maxBytes - The maximum allowed bytes before erroring.
 */
export class MaxBytesTransformStream extends TransformStream<
    Uint8Array,
    Uint8Array
> {
    constructor(maxBytes: number) {
        // Note: negation accounts for invalid value types (NaN, non numbers)
        if (!(maxBytes >= 0)) {
            throw new TypeError("maxBytes must be a non-negative number");
        }

        let bytesRead = 0;

        super({
            transform: (
                chunk: Uint8Array,
                ctrl: TransformStreamDefaultController<Uint8Array>,
            ) => {
                if ((bytesRead += chunk.length) <= maxBytes) {
                    ctrl.enqueue(chunk);
                } else {
                    ctrl.error(new Error("Response too large"));
                }
            },
        });
    }
}

```

### fetch/src/_internal/net.ts

```
import { createConnection } from "node:net";
import { connect as nodeTlsConnect } from "node:tls";
import type {
    ConnectFunction,
    TcpEndpoint,
    TlsUpgradeFunction,
} from "@fuman/net";
import {
    type NodeTlsConnectOptions,
    type NodeTlsUpgradeOptions,
    TcpConnection,
    TlsConnection,
} from "@fuman/node";

type WithSignal<T = {}> = T & { signal?: AbortSignal };

type SocketLike = {
    on(event: string, handler: (...args: any[]) => void): void;
    removeListener(event: string, handler: (...args: any[]) => void): void;
    destroy(error?: Error): void;
};

export interface AbortError extends Error {
    name: "AbortError";
}

function toAbortError(reason: unknown): AbortError {
    if (reason instanceof Error && reason.name === "AbortError") {
        return reason as AbortError;
    }

    const message =
        reason instanceof Error
            ? reason.message
            : typeof reason === "string"
              ? reason
              : "The operation was aborted";

    if (typeof DOMException !== "undefined") {
        return new DOMException(message, "AbortError") as AbortError;
    }

    const error = new Error(message) as AbortError;
    error.name = "AbortError";
    return error;
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw toAbortError(signal.reason);
    }
}

async function withSocketSignal<T extends SocketLike, R>(
    createSocket: () => T,
    wrapConnection: (socket: T) => R,
    signal?: AbortSignal,
    readyEvent = "connect",
    onFailureCleanup?: () => void,
): Promise<R> {
    return new Promise<R>((resolve, reject) => {
        throwIfAborted(signal);

        const socket = createSocket();
        let settled = false;

        const cleanup = () => {
            socket.removeListener("error", onError);
            socket.removeListener("timeout", onError);
            socket.removeListener(readyEvent, onReady);
            signal?.removeEventListener("abort", onAbort);
        };

        const safeCleanup = () => {
            try {
                onFailureCleanup?.();
            } catch {}
        };

        const resolveOnce = (value: R) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(value);
        };

        const rejectOnce = (error: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };

        const onError = (error: unknown) => {
            safeCleanup();
            rejectOnce(error);
        };

        const onAbort = () => {
            const error = toAbortError(signal?.reason);
            safeCleanup();
            rejectOnce(error);

            try {
                socket.destroy(error);
            } catch {}
        };

        const onReady = () => {
            resolveOnce(wrapConnection(socket));
        };

        signal?.addEventListener("abort", onAbort, { once: true });
        socket.on("error", onError);
        socket.on("timeout", onError);
        socket.on(readyEvent, onReady);
    });
}

export const connectTcp: ConnectFunction<
    WithSignal<TcpEndpoint>,
    TcpConnection
> = async ({ address, port, signal }) => {
    return withSocketSignal(
        () => createConnection({ host: address, port }),
        (socket) => new TcpConnection(socket),
        signal,
    );
};

export const connectTls: ConnectFunction<
    WithSignal<NodeTlsConnectOptions>,
    TlsConnection
> = async (options) => {
    const { address, port, signal, sni, caCerts, alpnProtocols, extraOptions } =
        options;

    return withSocketSignal(
        () =>
            nodeTlsConnect({
                host: address,
                port,
                ca: caCerts,
                ALPNProtocols: alpnProtocols,
                servername: sni,
                ...extraOptions,
            }),
        (socket) => new TlsConnection(socket),
        signal,
        "secureConnect",
    );
};

export const upgradeTls: TlsUpgradeFunction<
    WithSignal<NodeTlsUpgradeOptions>,
    TcpConnection,
    TlsConnection
> = async (conn, options) => {
    return withSocketSignal(
        () =>
            nodeTlsConnect({
                socket: conn.socket,
                ca: options.caCerts,
                ALPNProtocols: options.alpnProtocols,
                servername: options.sni,
                ...options.extraOptions,
            }),
        (socket) => new TlsConnection(socket),
        options.signal,
        "secureConnect",
        () => conn.close(),
    );
};

```

### fetch/src/_internal/guards.ts

```
import { Readable } from "node:stream";

export interface FormDataPolyfill extends Readable {
    getBoundary(): string;
    getLengthSync(): number;
    hasKnownLength(): boolean;
}

export const isReadable = (object: any): object is Readable =>
    Readable.isReadable(object);

export const isIterable = (
    object: any,
): object is AsyncIterable<any> | Iterable<any> =>
    typeof object?.[Symbol.asyncIterator] === "function" ||
    typeof object?.[Symbol.iterator] === "function";

export const isMultipartFormDataStream = (
    object: any,
): object is FormDataPolyfill =>
    typeof object?.getBoundary === "function" &&
    typeof object?.hasKnownLength === "function" &&
    typeof object?.getLengthSync === "function" &&
    Readable.isReadable(object);

export const isFormData = (object: any): object is FormData =>
    typeof object === "object" &&
    typeof object?.append === "function" &&
    typeof object?.set === "function" &&
    typeof object?.get === "function" &&
    typeof object?.getAll === "function" &&
    typeof object?.delete === "function" &&
    typeof object?.keys === "function" &&
    typeof object?.values === "function" &&
    typeof object?.entries === "function" &&
    typeof object?.constructor === "function" &&
    object?.[Symbol.toStringTag] === "FormData";

export const isURLSearchParameters = (object: any): object is URLSearchParams =>
    typeof object === "object" &&
    typeof object?.append === "function" &&
    typeof object?.delete === "function" &&
    typeof object?.get === "function" &&
    typeof object?.getAll === "function" &&
    typeof object?.has === "function" &&
    typeof object?.set === "function" &&
    typeof object?.sort === "function" &&
    object?.[Symbol.toStringTag] === "URLSearchParams";

export const isReadableStream = (object: any): object is ReadableStream =>
    typeof object === "object" &&
    typeof object?.getReader === "function" &&
    typeof object?.cancel === "function" &&
    typeof object?.tee === "function";

export const isBlob = (object: any): object is Blob => {
    if (
        typeof object === "object" &&
        typeof object?.arrayBuffer === "function" &&
        typeof object?.type === "string" &&
        typeof object?.stream === "function" &&
        typeof object?.constructor === "function"
    ) {
        const tag = object[Symbol.toStringTag];
        return (
            typeof tag === "string" &&
            (tag.startsWith("Blob") || tag.startsWith("File"))
        );
    }
    return false;
};

```

### fetch/src/_internal/error-adapters.ts

```
import {
    ConnectionError,
    ConnectTimeoutError,
    FetchError,
    type FetchErrorContext,
    RequestAbortedError,
    RequestWriteError,
    ResponseBodyError,
    ResponseDecodeError,
    ResponseHeaderError,
} from "../errors";

type ErrorWithCause = Error & {
    cause?: unknown;
    code?: unknown;
};

export interface ErrorMappingContext extends FetchErrorContext {}

function getErrorChain(error: unknown, maxDepth = 8): ErrorWithCause[] {
    const chain: ErrorWithCause[] = [];
    const seen = new Set<unknown>();

    let current: unknown = error;
    let depth = 0;

    while (current instanceof Error && depth < maxDepth && !seen.has(current)) {
        const entry = current as ErrorWithCause;
        chain.push(entry);
        seen.add(current);
        current = entry.cause;
        depth += 1;
    }

    return chain;
}

export function unknownToError(error: unknown): Error {
    if (error instanceof Error) return error;
    if (typeof error === "string") return new Error(error);
    return new Error("Unknown error", { cause: error });
}

export function isAbortLike(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const name =
        "name" in error ? (error as { name?: unknown }).name : undefined;
    return name === "AbortError" || name === "TimeoutError";
}

export function defaultAbortDomException(): DOMException {
    return new DOMException("This operation was aborted", "AbortError");
}

export function getRawAbortReason(signal?: AbortSignal): unknown {
    return signal?.reason ?? defaultAbortDomException();
}

export function toAbortCause(signal?: AbortSignal, fallback?: unknown): Error {
    return unknownToError(
        signal?.reason ?? fallback ?? defaultAbortDomException(),
    );
}

export function isTimeoutReason(reason: unknown): boolean {
    return (
        !!reason &&
        typeof reason === "object" &&
        "name" in reason &&
        (reason as { name?: unknown }).name === "TimeoutError"
    );
}

function looksLikeDecodeError(error: Error): boolean {
    const chain = getErrorChain(error);

    for (const entry of chain) {
        const code =
            typeof entry.code === "string" ? entry.code.toLowerCase() : "";

        const text = `${entry.name} ${entry.message} ${code}`.toLowerCase();

        if (
            code === "z_data_error" ||
            code === "z_buf_error" ||
            code === "z_stream_error" ||
            text.includes("decode") ||
            text.includes("decompress") ||
            text.includes("encoding") ||
            text.includes("gzip") ||
            text.includes("deflate") ||
            text.includes("brotli") ||
            text.includes("incorrect header check") ||
            text.includes("invalid block type") ||
            text.includes("invalid distance") ||
            text.includes("invalid stored block") ||
            text.includes("unexpected end of file") ||
            text.includes("unexpected end of stream") ||
            text.includes("header check")
        ) {
            return true;
        }
    }

    return false;
}

export function mapAdvancedConnectError(
    error: unknown,
    {
        signal,
        context,
        timedOut,
    }: {
        signal?: AbortSignal;
        context?: ErrorMappingContext;
        timedOut?: boolean;
    },
): FetchError {
    if (error instanceof FetchError) return error;

    if (timedOut || isTimeoutReason(signal?.reason)) {
        return new ConnectTimeoutError(
            unknownToError(error),
            context,
            "Connection timeout",
        );
    }

    if (signal?.aborted || isAbortLike(error)) {
        return new RequestAbortedError(
            toAbortCause(signal, error),
            context,
            "The request was aborted while connecting",
        );
    }

    return new ConnectionError(
        unknownToError(error),
        context,
        "Connection failed",
    );
}

export function mapAdvancedSendError(
    error: unknown,
    {
        signal,
        context,
        phase,
    }: {
        signal?: AbortSignal;
        context?: ErrorMappingContext;
        phase: "request" | "response" | "body";
    },
): FetchError {
    if (error instanceof FetchError) return error;

    if (signal?.aborted || isAbortLike(error)) {
        return new RequestAbortedError(
            toAbortCause(signal, error),
            context,
            phase === "body"
                ? "The request was aborted while reading the response body"
                : "The request was aborted",
        );
    }

    const cause = unknownToError(error);

    if (phase === "request") {
        return new RequestWriteError(cause, context);
    }

    if (phase === "response") {
        return new ResponseHeaderError(cause, context);
    }

    if (looksLikeDecodeError(cause)) {
        return new ResponseDecodeError(cause, context);
    }

    return new ResponseBodyError(cause, context);
}

export function wrapResponseBodyErrors(
    response: Response,
    mapError: (error: unknown) => unknown,
): Response {
    const source = response.body;
    if (!source) return response;

    const reader = source.getReader();

    let pending: Uint8Array | null = null;

    const wrapped = new ReadableStream<Uint8Array>({
        type: "bytes",

        async pull(controller: ReadableByteStreamController) {
            try {
                const byob = controller.byobRequest;

                if (byob?.view) {
                    const target = new Uint8Array(
                        byob.view.buffer,
                        byob.view.byteOffset,
                        byob.view.byteLength,
                    );

                    if (target.byteLength === 0) {
                        byob.respond(0);
                        return;
                    }

                    let written = 0;

                    if (pending && pending.byteLength > 0) {
                        const n = Math.min(
                            target.byteLength,
                            pending.byteLength,
                        );
                        target.set(pending.subarray(0, n), written);
                        written += n;
                        pending =
                            n === pending.byteLength
                                ? null
                                : pending.subarray(n);
                    }

                    while (written === 0) {
                        const { done, value } = await reader.read();

                        if (done) {
                            byob.respond(0);
                            controller.close();
                            return;
                        }

                        if (!value || value.byteLength === 0) {
                            continue;
                        }

                        const n = Math.min(
                            target.byteLength - written,
                            value.byteLength,
                        );

                        target.set(value.subarray(0, n), written);
                        written += n;

                        if (n < value.byteLength) {
                            pending = value.subarray(n);
                        }
                    }

                    byob.respond(written);
                    return;
                }

                if (pending && pending.byteLength > 0) {
                    const chunk = pending;
                    pending = null;
                    controller.enqueue(
                        new Uint8Array(
                            chunk.buffer as ArrayBuffer,
                            chunk.byteOffset,
                            chunk.byteLength,
                        ),
                    );
                    return;
                }

                const { done, value } = await reader.read();

                if (done) {
                    controller.close();
                    return;
                }

                if (value && value.byteLength > 0) {
                    controller.enqueue(value);
                }
            } catch (error) {
                controller.error(mapError(error));
            }
        },

        async cancel(reason) {
            pending = null;
            await reader.cancel(reason);
        },
    });

    return new Response(wrapped, {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers(response.headers),
    });
}

export function toWebFetchError(error: unknown, signal?: AbortSignal): unknown {
    if (signal?.aborted) {
        return getRawAbortReason(signal);
    }

    if (error instanceof DOMException || error instanceof TypeError) {
        return error;
    }

    const cause = error instanceof Error ? error : unknownToError(error);
    return new TypeError("fetch failed", { cause });
}

export function toWebBodyReadError(
    error: unknown,
    signal?: AbortSignal,
): unknown {
    if (signal?.aborted) {
        return getRawAbortReason(signal);
    }

    if (
        error instanceof DOMException ||
        error instanceof TypeError ||
        error instanceof RangeError
    ) {
        return error;
    }

    const cause = error instanceof Error ? error : unknownToError(error);
    return new TypeError("Failed to read response body", { cause });
}

```

### fetch/src/errors.ts

```
export const ErrorType = {
    ABORTED: "ABORTED",
    NETWORK: "NETWORK",
    TIMEOUT: "TIMEOUT",
    HTTP_CLIENT_ERROR: "HTTP_CLIENT_ERROR",
    HTTP_SERVER_ERROR: "HTTP_SERVER_ERROR",
} as const;

export type ErrorType = (typeof ErrorType)[keyof typeof ErrorType];

export const FetchErrorCode = {
    ABORTED: "ERR_FETCH_ABORTED",
    TIMEOUT: "ERR_FETCH_TIMEOUT",
    CONNECTION: "ERR_FETCH_CONNECTION",
    AGENT_CLOSED: "ERR_FETCH_AGENT_CLOSED",
    AGENT_BUSY: "ERR_FETCH_AGENT_BUSY",
    ORIGIN_MISMATCH: "ERR_FETCH_ORIGIN_MISMATCH",
    UNSUPPORTED_PROTOCOL: "ERR_FETCH_UNSUPPORTED_PROTOCOL",
    UNSUPPORTED_METHOD: "ERR_FETCH_UNSUPPORTED_METHOD",
    TLS_ALPN: "ERR_FETCH_TLS_ALPN",
    REQUEST_WRITE: "ERR_FETCH_REQUEST_WRITE",
    RESPONSE_HEADERS: "ERR_FETCH_RESPONSE_HEADERS",
    RESPONSE_BODY: "ERR_FETCH_RESPONSE_BODY",
    RESPONSE_DECODE: "ERR_FETCH_RESPONSE_DECODE",
    HTTP_STATUS: "ERR_FETCH_HTTP_STATUS",
} as const;

export type FetchErrorCode =
    (typeof FetchErrorCode)[keyof typeof FetchErrorCode];

export type FetchErrorPhase =
    | "agent"
    | "connect"
    | "request"
    | "response"
    | "body"
    | "decode"
    | "policy";

export interface FetchErrorContext {
    url?: string;
    method?: string;
    origin?: string;
    scheme?: string;
    host?: string;
    port?: number;
    status?: number;
    alpn?: string | null;
    details?: Record<string, unknown>;
}

export interface FetchErrorOptions {
    message: string;
    code: FetchErrorCode;
    phase: FetchErrorPhase;
    cause?: unknown;
    context?: FetchErrorContext;
    retryable?: boolean;
    type?: ErrorType;
}

export class FetchError extends Error {
    readonly code: FetchErrorCode;
    readonly phase: FetchErrorPhase;
    readonly context?: FetchErrorContext;
    readonly retryable: boolean;
    readonly type?: ErrorType;
    override readonly cause: unknown;

    constructor(options: FetchErrorOptions) {
        super(options.message, { cause: options.cause });
        this.code = options.code;
        this.phase = options.phase;
        this.context = options.context;
        this.retryable = options.retryable ?? false;
        this.type = options.type;
        this.cause = options.cause;
        Object.setPrototypeOf(this, new.target.prototype);
    }

    override get name(): string {
        return (this.constructor as typeof Error).name;
    }

    get [Symbol.toStringTag](): string {
        return this.name;
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            phase: this.phase,
            retryable: this.retryable,
            type: this.type,
            context: this.context,
            cause:
                this.cause instanceof Error
                    ? {
                          name: this.cause.name,
                          message: this.cause.message,
                      }
                    : this.cause,
        };
    }
}

export class RequestAbortedError extends FetchError {
    constructor(
        cause?: unknown,
        context?: FetchErrorContext,
        message?: string,
    ) {
        super({
            message: message ?? "The request was aborted",
            code: FetchErrorCode.ABORTED,
            phase: "request",
            cause,
            context,
            retryable: false,
            type: ErrorType.ABORTED,
        });
    }
}

export class ConnectTimeoutError extends FetchError {
    constructor(
        cause?: unknown,
        context?: FetchErrorContext,
        message?: string,
    ) {
        super({
            message: message ?? "Connection timed out",
            code: FetchErrorCode.TIMEOUT,
            phase: "connect",
            cause,
            context,
            retryable: true,
            type: ErrorType.TIMEOUT,
        });
    }
}

export class ConnectionError extends FetchError {
    constructor(
        cause?: unknown,
        context?: FetchErrorContext,
        message?: string,
    ) {
        super({
            message: message ?? "Network connection failed",
            code: FetchErrorCode.CONNECTION,
            phase: "connect",
            cause,
            context,
            retryable: true,
            type: ErrorType.NETWORK,
        });
    }
}

export class AgentClosedError extends FetchError {
    constructor(context?: FetchErrorContext, cause?: unknown) {
        super({
            message: "Agent is closed",
            code: FetchErrorCode.AGENT_CLOSED,
            phase: "agent",
            cause,
            context,
            retryable: false,
            type: ErrorType.NETWORK,
        });
    }
}

export class AgentBusyError extends FetchError {
    constructor(context?: FetchErrorContext, cause?: unknown) {
        super({
            message: "Agent is busy",
            code: FetchErrorCode.AGENT_BUSY,
            phase: "agent",
            cause,
            context,
            retryable: true,
            type: ErrorType.NETWORK,
        });
    }
}

export class OriginMismatchError extends FetchError {
    constructor(
        expectedOrigin: string,
        actualOrigin: string,
        context?: FetchErrorContext,
    ) {
        super({
            message: `Agent origin mismatch: expected ${expectedOrigin}, got ${actualOrigin}`,
            code: FetchErrorCode.ORIGIN_MISMATCH,
            phase: "policy",
            context: {
                ...context,
                details: {
                    ...(context?.details ?? {}),
                    expectedOrigin,
                    actualOrigin,
                },
            },
            retryable: false,
            type: ErrorType.NETWORK,
        });
    }
}

export class UnsupportedProtocolError extends FetchError {
    constructor(protocol: string, context?: FetchErrorContext) {
        super({
            message: `Unsupported protocol: ${protocol}`,
            code: FetchErrorCode.UNSUPPORTED_PROTOCOL,
            phase: "policy",
            context,
            retryable: false,
            type: ErrorType.NETWORK,
        });
    }
}

export class UnsupportedMethodError extends FetchError {
    constructor(method: string, context?: FetchErrorContext) {
        super({
            message: `Unsupported method: ${method}`,
            code: FetchErrorCode.UNSUPPORTED_METHOD,
            phase: "policy",
            context,
            retryable: false,
            type: ErrorType.NETWORK,
        });
    }
}

export class UnsupportedAlpnProtocolError extends FetchError {
    constructor(alpn: string, context?: FetchErrorContext, cause?: unknown) {
        super({
            message: `Unsupported ALPN protocol negotiated: ${alpn}`,
            code: FetchErrorCode.TLS_ALPN,
            phase: "connect",
            cause,
            context: {
                ...context,
                alpn,
            },
            retryable: false,
            type: ErrorType.NETWORK,
        });
    }
}

export class RequestWriteError extends FetchError {
    constructor(
        cause?: unknown,
        context?: FetchErrorContext,
        message?: string,
    ) {
        super({
            message: message ?? "Failed to write HTTP request",
            code: FetchErrorCode.REQUEST_WRITE,
            phase: "request",
            cause,
            context,
            retryable: true,
            type: ErrorType.NETWORK,
        });
    }
}

export class ResponseHeaderError extends FetchError {
    constructor(
        cause?: unknown,
        context?: FetchErrorContext,
        message?: string,
    ) {
        super({
            message: message ?? "Failed while reading response headers",
            code: FetchErrorCode.RESPONSE_HEADERS,
            phase: "response",
            cause,
            context,
            retryable: true,
            type: ErrorType.NETWORK,
        });
    }
}

export class ResponseBodyError extends FetchError {
    constructor(
        cause?: unknown,
        context?: FetchErrorContext,
        message?: string,
    ) {
        super({
            message: message ?? "Failed while reading response body",
            code: FetchErrorCode.RESPONSE_BODY,
            phase: "body",
            cause,
            context,
            retryable: true,
            type: ErrorType.NETWORK,
        });
    }
}

export class ResponseDecodeError extends FetchError {
    constructor(
        cause?: unknown,
        context?: FetchErrorContext,
        message?: string,
    ) {
        super({
            message: message ?? "Failed while decoding response body",
            code: FetchErrorCode.RESPONSE_DECODE,
            phase: "decode",
            cause,
            context,
            retryable: false,
            type: ErrorType.NETWORK,
        });
    }
}

export class HttpStatusError extends FetchError {
    readonly statusCode: number;

    constructor(
        statusCode: number,
        context?: FetchErrorContext,
        cause?: unknown,
        message?: string,
    ) {
        super({
            message: message ?? `HTTP ${statusCode}`,
            code: FetchErrorCode.HTTP_STATUS,
            phase: "response",
            cause,
            context: {
                ...context,
                status: statusCode,
            },
            retryable: statusCode >= 500,
            type:
                statusCode < 500
                    ? ErrorType.HTTP_CLIENT_ERROR
                    : ErrorType.HTTP_SERVER_ERROR,
        });

        this.statusCode = statusCode;
    }
}

/* aliases legados por uma versão */
export { FetchError as FetchBaseError };
export class AbortError extends RequestAbortedError {}
export class NetworkError extends ConnectionError {}
export class TimeoutError extends ConnectTimeoutError {}
export class HttpError extends HttpStatusError {}

```

### fetch/src/agent.ts

```
import { Deferred } from "@fuman/utils";
import {
    mapAdvancedConnectError,
    mapAdvancedSendError,
    wrapResponseBodyErrors,
} from "./_internal/error-adapters";
import { raceSignal } from "./_internal/promises";
import {
    AgentBusyError,
    AgentClosedError,
    OriginMismatchError,
    RequestAbortedError,
    UnsupportedAlpnProtocolError,
    UnsupportedMethodError,
    UnsupportedProtocolError,
} from "./errors";
import { readResponse, writeRequest } from "./io/io";
import type { Agent, SendOptions } from "./types/agent";
import type { ConnectionLike, Dialer, DialTarget } from "./types/dialer";

const PORT_MAP = {
    "http:": 80,
    "https:": 443,
} as const;

const DEFAULT_ALPN_PROTOCOLS = ["http/1.1"] as const;

function resolvedDeferred(): Deferred<void> {
    const deferred = new Deferred<void>();
    deferred.resolve();
    return deferred;
}

function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    return signal ? raceSignal(promise, signal) : promise;
}

function isTlsConnection(
    conn: ConnectionLike,
): conn is ConnectionLike & { getAlpnProtocol(): string | null } {
    return (
        "getAlpnProtocol" in conn && typeof conn.getAlpnProtocol === "function"
    );
}

export function createAgent(
    dialer: Dialer,
    baseUrl: string,
    options: Agent.Options = {},
): Agent {
    const base = new URL(baseUrl);

    if (base.protocol !== "http:" && base.protocol !== "https:") {
        throw new UnsupportedProtocolError(base.protocol, {
            origin: base.origin,
            scheme: base.protocol,
            host: base.hostname,
            port: base.port ? Number.parseInt(base.port, 10) : undefined,
            url: base.toString(),
        });
    }

    const secure = base.protocol === "https:";
    const hostname = base.hostname;
    const port = base.port
        ? Number.parseInt(base.port, 10)
        : PORT_MAP[base.protocol];

    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
        throw new TypeError(`Invalid port in base URL: ${baseUrl}`);
    }

    const target: DialTarget = {
        address: hostname,
        port,
        secure,
        sni: secure ? hostname : undefined,
        alpnProtocols: secure ? [...DEFAULT_ALPN_PROTOCOLS] : undefined,
    };

    const connectOptions = options.connect ?? {};
    const readerOptions = options.io?.reader ?? {};
    const writerOptions = options.io?.writer ?? {};

    let conn: ConnectionLike | undefined;
    let connectPromise: Promise<ConnectionLike> | undefined;

    let closed = false;
    let isBusy = false;
    let lastUsedTime = Date.now();
    let idleDeferred = resolvedDeferred();

    function createBaseErrorContext() {
        return {
            origin: base.origin,
            scheme: base.protocol,
            host: hostname,
            port,
        } as const;
    }

    function createRequestErrorContext(url: URL, method?: string) {
        return {
            ...createBaseErrorContext(),
            url: url.toString(),
            method,
        } as const;
    }

    function markIdle(): void {
        isBusy = false;
        lastUsedTime = Date.now();
        idleDeferred.resolve();
    }

    function disposeConn(): void {
        const current = conn;
        conn = undefined;

        if (!current) return;

        try {
            current.close();
        } catch {}
    }

    function forceClose(): void {
        if (closed) return;
        closed = true;
        disposeConn();

        if (!isBusy) {
            markIdle();
        }
    }

    function assertUsable(): void {
        if (closed) {
            throw new AgentClosedError(createBaseErrorContext());
        }
    }

    function assertSameOrigin(url: URL): void {
        if (url.origin !== base.origin) {
            throw new OriginMismatchError(base.origin, url.origin, {
                ...createBaseErrorContext(),
                url: url.toString(),
            });
        }
    }

    function configureConnection(nextConn: ConnectionLike): void {
        nextConn.setNoDelay(connectOptions.noDelay ?? true);

        if (connectOptions.keepAlive !== null) {
            nextConn.setKeepAlive(connectOptions.keepAlive ?? true);
        }
    }

    async function connect(signal?: AbortSignal): Promise<ConnectionLike> {
        assertUsable();

        if (conn) return conn;
        if (connectPromise) return withSignal(connectPromise, signal);

        let timedOut = false;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        const abortController = new AbortController();

        const onAbort = () => {
            abortController.abort(signal?.reason);
        };

        const cleanup = () => {
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
                timeoutId = undefined;
            }

            if (signal) {
                signal.removeEventListener("abort", onAbort);
            }
        };

        if (signal) {
            if (signal.aborted) {
                abortController.abort(signal.reason);
            } else {
                signal.addEventListener("abort", onAbort, { once: true });
            }
        }

        if (
            connectOptions.timeout != null &&
            Number.isFinite(connectOptions.timeout) &&
            connectOptions.timeout > 0
        ) {
            timeoutId = setTimeout(() => {
                timedOut = true;
                abortController.abort(
                    new DOMException("Connection timed out", "TimeoutError"),
                );
            }, connectOptions.timeout);
        }

        connectPromise = (async () => {
            try {
                const nextConn = await dialer.dial(target, {
                    signal: abortController.signal,
                });

                if (closed) {
                    try {
                        nextConn.close();
                    } catch {}

                    throw new AgentClosedError(createBaseErrorContext());
                }

                configureConnection(nextConn);

                if (secure && isTlsConnection(nextConn)) {
                    const alpn = nextConn.getAlpnProtocol();
                    if (alpn != null && alpn !== "" && alpn !== "http/1.1") {
                        try {
                            nextConn.close();
                        } catch {}

                        throw new UnsupportedAlpnProtocolError(
                            alpn,
                            createBaseErrorContext(),
                        );
                    }
                }

                conn = nextConn;
                return nextConn;
            } catch (error) {
                throw mapAdvancedConnectError(error, {
                    signal,
                    timedOut,
                    context: createBaseErrorContext(),
                });
            } finally {
                cleanup();
                connectPromise = undefined;
            }
        })();

        return withSignal(connectPromise, signal);
    }

    async function send(sendOptions: SendOptions): Promise<Response> {
        assertUsable();

        const url =
            typeof sendOptions.url === "string"
                ? new URL(sendOptions.url)
                : sendOptions.url;

        const method = sendOptions.method.toUpperCase();
        const errorContext = createRequestErrorContext(url, method);

        if (sendOptions.signal?.aborted) {
            throw new RequestAbortedError(
                sendOptions.signal.reason,
                errorContext,
            );
        }

        if (isBusy) {
            throw new AgentBusyError(errorContext);
        }

        assertSameOrigin(url);

        if (method === "CONNECT") {
            throw new UnsupportedMethodError("CONNECT", errorContext);
        }

        isBusy = true;
        idleDeferred = new Deferred<void>();

        let finalized = false;
        let activeConn: ConnectionLike | undefined;

        const finalize = (reusable: boolean) => {
            if (finalized) return;
            finalized = true;

            if (!reusable || closed) {
                if (conn === activeConn) {
                    disposeConn();
                } else if (activeConn) {
                    try {
                        activeConn.close();
                    } catch {}
                }
            }

            markIdle();
        };

        const abortListener = () => {
            if (activeConn) {
                if (conn === activeConn) {
                    conn = undefined;
                }

                try {
                    activeConn.close();
                } catch {}
            }
        };

        try {
            activeConn = await connect(sendOptions.signal);

            sendOptions.signal?.addEventListener("abort", abortListener, {
                once: true,
            });

            try {
                await withSignal(
                    writeRequest(
                        activeConn,
                        {
                            url,
                            method,
                            headers: sendOptions.headers,
                            body: sendOptions.body ?? null,
                            signal: sendOptions.signal,
                        },
                        writerOptions,
                    ),
                    sendOptions.signal,
                );
            } catch (error) {
                throw mapAdvancedSendError(error, {
                    signal: sendOptions.signal,
                    context: errorContext,
                    phase: "request",
                });
            }

            const isHeadRequest = method === "HEAD";
            const shouldIgnoreBody = (status: number) =>
                isHeadRequest ||
                (status >= 100 && status < 200) ||
                status === 204 ||
                status === 304;

            let response: Response;

            try {
                response = await withSignal(
                    readResponse(
                        activeConn,
                        readerOptions,
                        shouldIgnoreBody,
                        (reusable) => {
                            sendOptions.signal?.removeEventListener(
                                "abort",
                                abortListener,
                            );
                            finalize(reusable);
                        },
                    ),
                    sendOptions.signal,
                );
            } catch (error) {
                throw mapAdvancedSendError(error, {
                    signal: sendOptions.signal,
                    context: errorContext,
                    phase: "response",
                });
            }

            return wrapResponseBodyErrors(response, (error) =>
                mapAdvancedSendError(error, {
                    signal: sendOptions.signal,
                    context: errorContext,
                    phase: "body",
                }),
            );
        } catch (error) {
            sendOptions.signal?.removeEventListener("abort", abortListener);

            if (activeConn) {
                if (conn === activeConn) {
                    conn = undefined;
                }

                try {
                    activeConn.close();
                } catch {}
            }

            finalize(false);
            throw error;
        }
    }

    return {
        [Symbol.dispose]: forceClose,
        close: forceClose,
        hostname,
        port,
        send,
        whenIdle(): Promise<void> {
            return idleDeferred.promise;
        },
        get isIdle(): boolean {
            return !isBusy;
        },
        get lastUsed(): number {
            return lastUsedTime;
        },
    };
}

```

### fetch/src/index.ts

```
export { connectTcp, connectTls, upgradeTls } from "./_internal/net";
export * from "./body";
export * from "./dialers";
export * from "./encoding";
export * from "./errors";
export * from "./fetch";
export * from "./types";

```

### fetch/src/encoding.ts

```
import { Readable } from "node:stream";
import { nodeReadableToWeb } from "@fuman/node";

type ByteStream = ReadableStream<Uint8Array>;
type ByteSource = ByteStream | AsyncIterable<Uint8Array>;
type ByteTransform = TransformStream<Uint8Array, Uint8Array>;

function applyTransforms(
    stream: ByteSource,
    contentEncoding: string | string[] | undefined,
    factory: (contentEncoding?: string | string[]) => ByteTransform[],
): ByteSource {
    const transforms = factory(contentEncoding);
    if (transforms.length === 0) return stream;

    // When transforms are required, always operate as Web Streams to use pipeThrough.
    let result: ByteStream;

    if (stream instanceof ReadableStream) {
        result = stream;
    } else {
        result = nodeReadableToWeb(Readable.from(stream));
    }

    for (const t of transforms) {
        result = result.pipeThrough(t);
    }

    return result;
}

export function decodeStream(
    stream: ByteStream,
    contentEncoding?: string | string[],
): ByteStream;
export function decodeStream(
    stream: AsyncIterable<Uint8Array>,
    contentEncoding?: string | string[],
): AsyncIterable<Uint8Array> | ByteStream;
export function decodeStream(
    stream: ByteSource,
    contentEncoding?: string | string[],
): ByteSource {
    return applyTransforms(stream, contentEncoding, createDecoders);
}

export function encodeStream(
    stream: ByteStream,
    contentEncoding?: string | string[],
): ByteStream;
export function encodeStream(
    stream: AsyncIterable<Uint8Array>,
    contentEncoding?: string | string[],
): AsyncIterable<Uint8Array> | ByteStream;
export function encodeStream(
    stream: ByteSource,
    contentEncoding?: string | string[],
): ByteSource {
    return applyTransforms(stream, contentEncoding, createEncoders);
}

/**
 * Create a series of decoding streams based on the content-encoding header. The
 * resulting streams should be piped together to decode the content.
 *
 * @see {@link https://datatracker.ietf.org/doc/html/rfc9110#section-8.4.1}
 */
export function createDecoders(
    contentEncoding?: string | string[],
): ByteTransform[] {
    const decoders: ByteTransform[] = [];

    if (contentEncoding?.length) {
        const encodings: string[] = Array.isArray(contentEncoding)
            ? contentEncoding.flatMap(commaSplit)
            : contentEncoding.split(",");

        for (const encoding of encodings) {
            const normalizedEncoding = normalizeEncoding(encoding);

            // identity is not valid for Content-Encoding (it is for Accept-Encoding).
            if (normalizedEncoding === "identity") continue;

            decoders.push(createDecoder(normalizedEncoding));
        }
    }

    // Decoding must be applied in reverse order of encoding.
    return decoders.reverse();
}

/**
 * Create a series of encoding streams based on the content-encoding header (or
 * transfer-coding list).
 *
 * The resulting streams should be piped together to apply the encoding in the
 * declared order.
 *
 * @see {@link https://datatracker.ietf.org/doc/html/rfc9110#section-8.4.1}
 */
export function createEncoders(
    contentEncoding?: string | string[],
): ByteTransform[] {
    const encoders: ByteTransform[] = [];

    if (contentEncoding?.length) {
        const encodings: string[] = Array.isArray(contentEncoding)
            ? contentEncoding.flatMap(commaSplit)
            : contentEncoding.split(",");

        for (const encoding of encodings) {
            const normalizedEncoding = normalizeEncoding(encoding);

            if (normalizedEncoding === "identity") continue;

            encoders.push(createEncoder(normalizedEncoding));
        }
    }

    return encoders;
}

function commaSplit(header: string): string[] {
    return header.split(",");
}

function normalizeEncoding(encoding: string) {
    // https://www.rfc-editor.org/rfc/rfc7231#section-3.1.2.1
    // > All content-coding values are case-insensitive...
    return encoding.trim().toLowerCase();
}

function createDecoder(normalizedEncoding: string): ByteTransform {
    switch (normalizedEncoding) {
        // https://www.rfc-editor.org/rfc/rfc9112.html#section-7.2
        case "gzip":
        case "x-gzip":
            return new DecompressionStream("gzip") as ByteTransform;
        case "deflate":
        case "x-deflate":
            return new DecompressionStream("deflate") as ByteTransform;
        case "zstd":
        case "x-zstd":
            return new DecompressionStream("zstd" as any) as ByteTransform;
        case "br":
            return new DecompressionStream("brotli" as any) as ByteTransform;
        case "identity":
            return new TransformStream(); // Pass-through
        default:
            throw new TypeError(
                `Unsupported content-encoding: "${normalizedEncoding}"`,
            );
    }
}

function createEncoder(normalizedEncoding: string): ByteTransform {
    switch (normalizedEncoding) {
        case "gzip":
        case "x-gzip":
            return new CompressionStream("gzip") as ByteTransform;
        case "deflate":
        case "x-deflate":
            return new CompressionStream("deflate") as ByteTransform;
        case "zstd":
        case "x-zstd":
            return new CompressionStream("zstd" as any) as ByteTransform;
        case "br":
            return new CompressionStream("brotli" as any) as ByteTransform;
        case "identity":
            return new TransformStream(); // Pass-through
        default:
            throw new TypeError(
                `Unsupported content-encoding: "${normalizedEncoding}"`,
            );
    }
}

```

### fetch/src/agent-pool.ts

```
import { createPool } from "generic-pool";
import { createAgent } from "./agent";
import { AutoDialer } from "./dialers";
import { UnsupportedProtocolError } from "./errors";
import type {
    Agent,
    AgentPool,
    AgentPoolOptions,
    SendOptions,
} from "./types/agent";

const defaultEvictionInterval = 10_000;
const defaultMax = Number.MAX_SAFE_INTEGER;
const defaultIdleTimeout = 30_000;

export function createAgentPool(
    baseUrl: string,
    options: AgentPoolOptions = {},
): AgentPool {
    const poolUrl = new URL(baseUrl);

    const evictionRunIntervalMillis =
        options.poolIdleTimeout !== false
            ? Math.min(
                  options.poolIdleTimeout || defaultEvictionInterval,
                  defaultEvictionInterval,
              )
            : 0;
    const max = options.poolMaxPerHost
        ? Math.max(1, options.poolMaxPerHost)
        : defaultMax;
    const softIdleTimeoutMillis =
        options.poolIdleTimeout !== false
            ? Math.max(1, options.poolIdleTimeout || defaultIdleTimeout)
            : -1;
    const min =
        softIdleTimeoutMillis > 0 && options.poolMaxIdlePerHost
            ? Math.max(0, options.poolMaxIdlePerHost)
            : 0;

    if (poolUrl.protocol !== "http:" && poolUrl.protocol !== "https:") {
        throw new UnsupportedProtocolError(poolUrl.protocol, {
            origin: poolUrl.origin,
            scheme: poolUrl.protocol,
            host: poolUrl.hostname,
            port: poolUrl.port ? Number.parseInt(poolUrl.port, 10) : undefined,
        });
    }

    const dialer = options.dialer ?? new AutoDialer();
    const connectOptions = options.connect ?? {};
    const ioOptions = options.io;

    const pool = createPool<Agent>(
        {
            async create() {
                return createAgent(dialer, baseUrl, {
                    connect: connectOptions,
                    io: ioOptions,
                });
            },
            async destroy(agent) {
                agent.close();
            },
        },
        {
            autostart: false,
            evictionRunIntervalMillis,
            softIdleTimeoutMillis,
            max,
            min,
        },
    );

    let releaseAgentFns: Array<(forceClose?: boolean) => Promise<void>> = [];

    async function send(sendOptions: SendOptions): Promise<Response> {
        let agent: Agent | undefined;
        let agentReleased = false;

        const releaseAgentFn = async (forceClose = false) => {
            if (!agent || agentReleased) {
                return;
            }

            agentReleased = true;
            releaseAgentFns = releaseAgentFns.filter(
                (r) => r !== releaseAgentFn,
            );

            if (forceClose) {
                agent.close();
            }

            if (pool.isBorrowedResource(agent)) {
                await pool.release(agent);
            }
        };

        releaseAgentFns.push(releaseAgentFn);

        try {
            agent = await pool.acquire();
            const responsePromise = agent.send(sendOptions);

            void agent.whenIdle().then(
                () => releaseAgentFn(),
                () => releaseAgentFn(true),
            );

            return responsePromise;
        } catch (error) {
            await releaseAgentFn(true);
            throw error;
        }
    }

    async function close() {
        await Promise.all(releaseAgentFns.map((release) => release(true)));
        await pool.drain();
        await pool.clear();
    }

    return {
        [Symbol.asyncDispose]: close,
        close,
        hostname: poolUrl.hostname,
        port: poolUrl.port
            ? Number.parseInt(poolUrl.port, 10)
            : poolUrl.protocol === "https:"
              ? 443
              : 80,
        send,
    };
}

```

### fetch/src/http-client.ts

```
import { createAgentPool } from "./agent-pool";
import type { AgentPool, AgentPoolOptions, SendOptions } from "./types/agent";

export class HttpClient implements AsyncDisposable {
    readonly #agentPools = new Map<string, AgentPool>();
    readonly #agentPoolOptions: Readonly<HttpClient.Options>;

    constructor(options: HttpClient.Options = {}) {
        this.#agentPoolOptions = { ...options };
    }

    async send(options: SendOptions): Promise<Response> {
        const agentPool = this.#getOrCreateAgentPool(options.url);
        return agentPool.send(options);
    }

    async close(): Promise<void> {
        const entries = Array.from(this.#agentPools.entries());

        const results = await Promise.allSettled(
            entries.map(([origin, agentPool]) =>
                agentPool.close().then(() => {
                    this.#agentPools.delete(origin);
                }),
            ),
        );

        const failed = results.find(
            (r): r is PromiseRejectedResult => r.status === "rejected",
        );

        if (failed) {
            throw failed.reason;
        }
    }

    async [Symbol.asyncDispose](): Promise<void> {
        await this.close();
    }

    #getOrCreateAgentPool(url: string | URL): AgentPool {
        const origin =
            typeof url === "string" ? new URL(url).origin : url.origin;

        let agentPool = this.#agentPools.get(origin);
        if (!agentPool) {
            agentPool = createAgentPool(origin, this.#agentPoolOptions);
            this.#agentPools.set(origin, agentPool);
        }

        return agentPool;
    }
}

export namespace HttpClient {
    /**
     * High-level client configuration.
     *
     * At this layer, the API exposes:
     * - pool management options
     * - socket connection options
     * - HTTP reader/writer options forwarded to the agent I/O layer
     */
    export interface Options extends AgentPoolOptions {}
}

/** Back-compat */
export interface HttpClientOptions extends HttpClient.Options {}

```

### fetch/src/body.ts

```
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { isAnyArrayBuffer } from "node:util/types";
import { nodeReadableToWeb } from "@fuman/node";
import { utf8 } from "@fuman/utils";
import { CRLF_LENGTH, CRLF_STR } from "./_internal/consts";
import {
    type FormDataPolyfill,
    isBlob,
    isFormData,
    isIterable,
    isMultipartFormDataStream,
    isReadable,
    isReadableStream,
    isURLSearchParameters,
} from "./_internal/guards";

export type BodyInit =
    | Exclude<RequestInit["body"], undefined | null>
    | FormDataPolyfill
    | Readable;

export interface BodyState {
    contentLength: number | null;
    contentType: string | null;
    body: Readable | ReadableStream | Uint8Array | null;
}

type Bytes = Uint8Array<ArrayBufferLike>;

const BOUNDARY = "-".repeat(2);

const makeFormBoundary = (): string =>
    `formdata-${randomBytes(8).toString("hex")}`;

const getFormHeader = (
    boundary: string,
    name: string,
    field: File | Blob | string,
): string => {
    let header = `${BOUNDARY}${boundary}${CRLF_STR}`;
    header += `Content-Disposition: form-data; name="${name}"`;
    if (isBlob(field)) {
        header += `; filename="${(field as File).name ?? "blob"}"${CRLF_STR}`;
        header += `Content-Type: ${field.type || "application/octet-stream"}`;
    }
    return `${header}${CRLF_STR}${CRLF_STR}`;
};

const getFormFooter = (boundary: string) =>
    `${BOUNDARY}${boundary}${BOUNDARY}${CRLF_STR}${CRLF_STR}`;

export const getFormDataLength = (form: FormData, boundary: string) => {
    let length = Buffer.byteLength(getFormFooter(boundary));
    for (const [name, value] of form)
        length +=
            Buffer.byteLength(getFormHeader(boundary, name, value)) +
            (isBlob(value) ? value.size : Buffer.byteLength(`${value}`)) +
            CRLF_LENGTH;
    return length;
};

async function* generatorOfFormData(
    form: FormData,
    boundary: string,
): AsyncGenerator<Bytes> {
    for (const [name, value] of form) {
        if (isBlob(value)) {
            yield utf8.encoder.encode(
                getFormHeader(boundary, name, value),
            ) as Bytes;

            // ReadableStream -> AsyncIterable (via for-await, supported in modern runtimes; cast keeps TS happy)
            for await (const chunk of value.stream() as any as AsyncIterable<Bytes>) {
                yield chunk;
            }

            yield utf8.encoder.encode(CRLF_STR) as Bytes;
        } else {
            yield utf8.encoder.encode(
                getFormHeader(boundary, name, value) + value + CRLF_STR,
            ) as Bytes;
        }
    }
    yield utf8.encoder.encode(getFormFooter(boundary)) as Bytes;
}

export const extractBody = (object: BodyInit | null): BodyState => {
    let type: string | null = null;
    let body: Readable | ReadableStream | Uint8Array | null;
    let size: number | null = null;

    if (object == null) {
        body = null;
        size = 0;
    } else if (typeof object === "string") {
        const bytes = utf8.encoder.encode(`${object}`);
        type = "text/plain;charset=UTF-8";
        size = bytes.byteLength;
        body = bytes;
    } else if (isURLSearchParameters(object)) {
        const bytes = utf8.encoder.encode(object.toString());
        body = bytes;
        size = bytes.byteLength;
        type = "application/x-www-form-urlencoded;charset=UTF-8";
    } else if (isBlob(object)) {
        size = object.size;
        type = object.type || null;
        body = object.stream();
    } else if (object instanceof Uint8Array) {
        body = object;
        size = object.byteLength;
    } else if (isAnyArrayBuffer(object)) {
        const bytes = new Uint8Array(object);
        body = bytes;
        size = bytes.byteLength;
    } else if (ArrayBuffer.isView(object)) {
        const bytes = new Uint8Array(
            object.buffer,
            object.byteOffset,
            object.byteLength,
        );
        body = bytes;
        size = bytes.byteLength;
    } else if (isReadableStream(object)) {
        body = object;
    } else if (isFormData(object)) {
        const boundary = makeFormBoundary();
        type = `multipart/form-data; boundary=${boundary}`;
        size = getFormDataLength(object, boundary);
        body = Readable.from(generatorOfFormData(object, boundary));
    } else if (isMultipartFormDataStream(object)) {
        type = `multipart/form-data; boundary=${object.getBoundary()}`;
        size = object.hasKnownLength() ? object.getLengthSync() : null;
        body = object as Readable;
    } else if (isReadable(object)) {
        body = object as Readable;
    } else if (isIterable(object)) {
        body = Readable.from(object);
    } else {
        const bytes = utf8.encoder.encode(`${object}`);
        type = "text/plain;charset=UTF-8";
        body = bytes;
        size = bytes.byteLength;
    }

    return {
        contentLength: size,
        contentType: type,
        body,
    };
};

const kBodyInternals = Symbol("kBodyInternals");

const toWebBodyInit = (
    body: Readable | ReadableStream | Uint8Array | null,
): globalThis.BodyInit | null => {
    if (body == null) return null;
    if (isReadable(body)) {
        return nodeReadableToWeb(body);
    }
    return body as unknown as globalThis.BodyInit;
};

const bytesToArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
    const bytesAsArrayBuffer = new ArrayBuffer(bytes.byteLength);
    const bytesUint8 = new Uint8Array(bytesAsArrayBuffer);
    bytesUint8.set(bytes);
    return bytesAsArrayBuffer;
};

export class Body {
    private [kBodyInternals]: BodyState;

    constructor(init: BodyInit | null) {
        this[kBodyInternals] = extractBody(init);
    }

    get body() {
        return this[kBodyInternals].body;
    }

    get bodyUsed() {
        const { body } = this[kBodyInternals];
        if (isReadable(body)) return Readable.isDisturbed(body);
        if (isReadableStream(body)) return body.locked;
        return false;
    }

    async arrayBuffer(): Promise<ArrayBuffer> {
        const { body } = this[kBodyInternals];
        if (body == null) return new ArrayBuffer(0);
        if (body instanceof Uint8Array) return bytesToArrayBuffer(body);
        return new Response(toWebBodyInit(body)).arrayBuffer();
    }

    async formData() {
        const { body, contentLength, contentType } = this[kBodyInternals];
        const headers: Record<string, string> = {};
        if (contentLength != null)
            headers["Content-Length"] = String(contentLength);
        if (contentType != null) headers["Content-Type"] = contentType;
        return new Response(toWebBodyInit(body), { headers }).formData();
    }

    async blob() {
        const { body, contentType } = this[kBodyInternals];
        if (body == null) {
            return new Blob([], { type: contentType ?? "" });
        }
        if (body instanceof Uint8Array) {
            return new Blob(
                [
                    new Uint8Array(
                        body.buffer as ArrayBuffer,
                        body.byteOffset,
                        body.byteLength,
                    ),
                ],
                { type: contentType ?? "" },
            );
        }
        return new Response(toWebBodyInit(body), {
            headers: contentType ? { "Content-Type": contentType } : undefined,
        }).blob();
    }

    async json() {
        const text = await this.text();
        return JSON.parse(text);
    }

    async text() {
        const { body } = this[kBodyInternals];
        if (body == null) return "";
        if (body instanceof Uint8Array) {
            return utf8.decoder.decode(body);
        }
        return new Response(toWebBodyInit(body)).text();
    }
}

```

### fetch/src/fetch.ts

```
import {
    toWebBodyReadError,
    toWebFetchError,
    wrapResponseBodyErrors,
} from "./_internal/error-adapters";
import type { BodyInit as FetchBodyInit } from "./body";
import { AutoDialer } from "./dialers";
import type { HttpClientOptions } from "./http-client";
import { HttpClient } from "./http-client";

export interface RequestInit
    extends Omit<globalThis.RequestInit, "body" | "headers"> {
    body?: FetchBodyInit | null;
    headers?: HeadersInit;

    /**
     * Optional client override for this call.
     *
     * Reader/Writer I/O options are configured at the client/pool level, not
     * per request.
     */
    client?: HttpClient;
}

/** Clearer export for consumers that want to avoid shadowing the global name. */
export interface FetchRequestInit extends RequestInit {}

/**
 * Options used only for constructing the default internal `HttpClient`.
 *
 * These are high-level client/pool/socket/I-O options; low-level Readers/Writers
 * are not configured per request through this fetch-like API.
 */
export interface FetchOptions extends HttpClientOptions {}

export interface FetchLike {
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    close(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
    readonly client: HttpClient;
}

function createDefaultHttpClient(options: FetchOptions = {}): HttpClient {
    return new HttpClient({
        ...options,
        dialer: options.dialer ?? new AutoDialer(),
    });
}

export function normalizeHeaders(headers?: HeadersInit): Headers {
    if (headers instanceof Headers) {
        return headers;
    }

    const normalized = new Headers();

    if (Array.isArray(headers)) {
        headers.forEach(([key, value]) => {
            normalized.append(key, value);
        });
        return normalized;
    }

    if (headers) {
        Object.entries(headers).forEach(([key, value]) => {
            if (Array.isArray(value)) {
                value.forEach((entry) => {
                    normalized.append(key, entry);
                });
            } else if (value !== undefined) {
                normalized.append(key, value);
            }
        });
    }

    return normalized;
}

function resolveUrl(input: RequestInfo | URL): URL {
    if (input instanceof URL) {
        return input;
    }

    if (input instanceof Request) {
        return new URL(input.url);
    }

    return new URL(String(input));
}

function resolveMethod(input: RequestInfo | URL, init: RequestInit): string {
    if (init.method != null) {
        return init.method.toUpperCase();
    }

    if (input instanceof Request) {
        return input.method.toUpperCase();
    }

    return "GET";
}

function resolveHeaders(input: RequestInfo | URL, init: RequestInit): Headers {
    if (init.headers !== undefined) {
        return normalizeHeaders(init.headers);
    }

    if (input instanceof Request) {
        return normalizeHeaders(input.headers);
    }

    return new Headers();
}

function resolveSignal(
    input: RequestInfo | URL,
    init: RequestInit,
): AbortSignal | undefined {
    return init.signal ?? (input instanceof Request ? input.signal : undefined);
}

function resolveBody(
    input: RequestInfo | URL,
    init: RequestInit,
): FetchBodyInit | null | undefined {
    if (init.body !== undefined) {
        return init.body;
    }

    if (!(input instanceof Request)) {
        return undefined;
    }

    if (input.bodyUsed) {
        throw new TypeError("Request body has already been used");
    }

    return input.body as FetchBodyInit | null;
}

function assertValidFetchUrl(url: URL): void {
    if (url.username || url.password) {
        throw new TypeError(
            "Request URL must not include embedded credentials",
        );
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new TypeError(`fetch failed: unsupported scheme ${url.protocol}`);
    }
}

function assertValidFetchBody(
    method: string,
    body: FetchBodyInit | null | undefined,
): void {
    if (body == null) return;

    if (method === "GET" || method === "HEAD") {
        throw new TypeError(`Request with ${method} method cannot have a body`);
    }
}

async function fetchImpl(
    input: RequestInfo | URL,
    init: RequestInit & { client: HttpClient },
): Promise<Response> {
    const url = resolveUrl(input);
    assertValidFetchUrl(url);

    const method = resolveMethod(input, init);
    const headers = resolveHeaders(input, init);
    const body = resolveBody(input, init);
    const signal = resolveSignal(input, init);

    assertValidFetchBody(method, body);

    try {
        const response = await init.client.send({
            url,
            method,
            headers,
            body: body ?? null,
            signal,
        });

        return wrapResponseBodyErrors(response, (error) =>
            toWebBodyReadError(error, signal),
        );
    } catch (error) {
        throw toWebFetchError(error, signal);
    }
}

export function createFetch(client?: HttpClient): FetchLike {
    const defaultHttpClient = client ?? createDefaultHttpClient();

    const fetchLike = (async (
        input: RequestInfo | URL,
        init: RequestInit = {},
    ): Promise<Response> => {
        const effectiveInit =
            init.client == null
                ? {
                      ...init,
                      client: defaultHttpClient,
                  }
                : (init as RequestInit & { client: HttpClient });

        return fetchImpl(
            input,
            effectiveInit as RequestInit & { client: HttpClient },
        );
    }) as FetchLike;

    const close = async (): Promise<void> => {
        if (client == null) {
            await defaultHttpClient.close();
        }
    };

    Object.defineProperties(fetchLike, {
        client: {
            configurable: false,
            enumerable: false,
            value: defaultHttpClient,
            writable: false,
        },
        close: {
            configurable: false,
            enumerable: false,
            value: close,
            writable: false,
        },
        [Symbol.asyncDispose]: {
            configurable: false,
            enumerable: false,
            value: close,
            writable: false,
        },
    });

    return fetchLike;
}

export type { HttpClientOptions };
export { HttpClient };

export const fetch = createFetch();
export default fetch;

```

### fetch/examples/simple.ts

```
import { fetch } from "../src";

const response = await fetch("https://httpbin.org/anything");
const body = await response.json();
console.log({ body });

fetch.close();

```

### fetch/tests/agent-pool.test.ts

```
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

```

### fetch/tests/fetch.test.ts

```
import { afterAll, describe, expect, test } from "bun:test";
import { createFetch, HttpClient, normalizeHeaders } from "../src/fetch.ts";
import { createTestServer } from "./test-utils.ts";

describe("fetch.ts weblike API", () => {
    const testServer = createTestServer();

    afterAll(async () => {
        await testServer.stop();
    });

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

    test("redirects are not auto-followed by the low-level implementation", async () => {
        const fetchLike = createFetch();

        try {
            const response = await fetchLike(`${testServer.baseUrl}/redirect`);
            expect(response.status).toBe(302);
            expect(response.headers.get("location")).toBe("/redirected-target");
            expect(await response.text()).toBe(
                "Redirecting to /redirected-target",
            );
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

```

### fetch/tests/agent.test.ts

```
import { afterAll, describe, expect, test } from "bun:test";
import { createAgent } from "../src/agent.ts";
import { AutoDialer } from "../src/dialers/index.ts";
import {
    AgentBusyError,
    OriginMismatchError,
    RequestAbortedError,
    ResponseDecodeError,
} from "../src/errors.ts";
import { createTestServer } from "./test-utils.ts";

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

```

### fetch/tests/errors.test.ts

```
import { describe, expect, test } from "bun:test";
import {
    AgentBusyError,
    ConnectionError,
    ConnectTimeoutError,
    ErrorType,
    FetchError,
    FetchErrorCode,
    HttpStatusError,
    OriginMismatchError,
    RequestAbortedError,
    ResponseBodyError,
    ResponseHeaderError,
    UnsupportedMethodError,
} from "../src/errors.ts";

describe("errors.ts", () => {
    test("base FetchError exposes code, phase, retryable and cause", () => {
        const cause = new Error("boom");
        const error = new ResponseHeaderError(cause, {
            url: "http://example.test/resource",
            method: "GET",
            origin: "http://example.test",
        });

        expect(error).toBeInstanceOf(FetchError);
        expect(error.name).toBe("ResponseHeaderError");
        expect(error.code).toBe(FetchErrorCode.RESPONSE_HEADERS);
        expect(error.phase).toBe("response");
        expect(error.retryable).toBe(true);
        expect(error.type).toBe(ErrorType.NETWORK);
        expect(error.cause).toBe(cause);
        expect(error.context?.url).toBe("http://example.test/resource");
        expect(error.context?.method).toBe("GET");
    });

    test("abort/connect/network errors expose the expected classifications", () => {
        const cause = new Error("boom");

        const aborted = new RequestAbortedError(cause, {
            url: "http://example.test/abort",
            method: "GET",
        });

        const timeout = new ConnectTimeoutError(cause, {
            host: "example.test",
            port: 443,
        });

        const network = new ConnectionError(cause, {
            host: "example.test",
            port: 443,
        });

        expect(aborted.code).toBe(FetchErrorCode.ABORTED);
        expect(aborted.phase).toBe("request");
        expect(aborted.retryable).toBe(false);
        expect(aborted.type).toBe(ErrorType.ABORTED);

        expect(timeout.code).toBe(FetchErrorCode.TIMEOUT);
        expect(timeout.phase).toBe("connect");
        expect(timeout.retryable).toBe(true);
        expect(timeout.type).toBe(ErrorType.TIMEOUT);

        expect(network.code).toBe(FetchErrorCode.CONNECTION);
        expect(network.phase).toBe("connect");
        expect(network.retryable).toBe(true);
        expect(network.type).toBe(ErrorType.NETWORK);
    });

    test("agent/policy errors expose specific metadata", () => {
        const busy = new AgentBusyError({
            origin: "http://example.test",
            host: "example.test",
            port: 80,
        });

        const mismatch = new OriginMismatchError(
            "http://a.test",
            "http://b.test",
            { url: "http://b.test/resource" },
        );

        const unsupportedMethod = new UnsupportedMethodError("CONNECT", {
            url: "http://example.test",
            method: "CONNECT",
        });

        expect(busy.code).toBe(FetchErrorCode.AGENT_BUSY);
        expect(busy.phase).toBe("agent");
        expect(busy.retryable).toBe(true);

        expect(mismatch.code).toBe(FetchErrorCode.ORIGIN_MISMATCH);
        expect(mismatch.phase).toBe("policy");
        expect(mismatch.retryable).toBe(false);
        expect(mismatch.context?.details?.expectedOrigin).toBe("http://a.test");
        expect(mismatch.context?.details?.actualOrigin).toBe("http://b.test");

        expect(unsupportedMethod.code).toBe(FetchErrorCode.UNSUPPORTED_METHOD);
        expect(unsupportedMethod.phase).toBe("policy");
        expect(unsupportedMethod.retryable).toBe(false);
    });

    test("HTTP status errors classify 4xx and 5xx correctly", () => {
        const http4xx = new HttpStatusError(404, {
            url: "http://example.test/not-found",
            method: "GET",
        });

        const http5xx = new HttpStatusError(503, {
            url: "http://example.test/unavailable",
            method: "GET",
        });

        expect(http4xx.code).toBe(FetchErrorCode.HTTP_STATUS);
        expect(http4xx.phase).toBe("response");
        expect(http4xx.retryable).toBe(false);
        expect(http4xx.type).toBe(ErrorType.HTTP_CLIENT_ERROR);
        expect(http4xx.statusCode).toBe(404);

        expect(http5xx.code).toBe(FetchErrorCode.HTTP_STATUS);
        expect(http5xx.phase).toBe("response");
        expect(http5xx.retryable).toBe(true);
        expect(http5xx.type).toBe(ErrorType.HTTP_SERVER_ERROR);
        expect(http5xx.statusCode).toBe(503);
    });

    test("toJSON exposes the stable diagnostic payload", () => {
        const cause = new Error("boom");
        const error = new ResponseBodyError(cause, {
            url: "http://example.test/stream",
            method: "GET",
        });

        expect(error.toJSON()).toEqual({
            name: "ResponseBodyError",
            message: "Failed while reading response body",
            code: FetchErrorCode.RESPONSE_BODY,
            phase: "body",
            retryable: true,
            type: ErrorType.NETWORK,
            context: {
                url: "http://example.test/stream",
                method: "GET",
            },
            cause: {
                name: "Error",
                message: "boom",
            },
        });
    });
});

```

### fetch/tests/io-options.test.ts

```
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

```

### fetch/tests/test-utils.ts

```
import { gzipSync } from "node:zlib";

export interface TestServer {
    server: ReturnType<typeof Bun.serve>;
    baseUrl: string;
    stop(): Promise<void>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function headersToObject(headers: Headers): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of headers.entries()) {
        out[key] = value;
    }
    return out;
}

function json(value: unknown, init?: ResponseInit): Response {
    return Response.json(value, init);
}

function textResponse(
    body: string,
    init?: ResponseInit & { headers?: Record<string, string> },
): Response {
    return new Response(body, {
        ...init,
        headers: {
            "content-type": "text/plain; charset=utf-8",
            ...(init?.headers ?? {}),
        },
    });
}

function headAwareText(
    request: Request,
    body: string,
    init?: ResponseInit & { headers?: Record<string, string> },
): Response {
    if (request.method === "HEAD") {
        return new Response(null, {
            ...init,
            headers: {
                "content-type": "text/plain; charset=utf-8",
                ...(init?.headers ?? {}),
            },
        });
    }

    return textResponse(body, init);
}

function headAwareJson(
    request: Request,
    body: unknown,
    init?: ResponseInit & { headers?: Record<string, string> },
): Response {
    if (request.method === "HEAD") {
        return new Response(null, {
            ...init,
            headers: {
                "content-type": "application/json",
                ...(init?.headers ?? {}),
            },
        });
    }

    return json(body, {
        ...init,
        headers: {
            "content-type": "application/json",
            ...(init?.headers ?? {}),
        },
    });
}

export function createTestServer(): TestServer {
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request: Request): Promise<Response> {
            const url = new URL(request.url);
            const headers = headersToObject(request.headers);

            switch (url.pathname) {
                case "/text": {
                    return headAwareText(request, "Hello, World!");
                }

                case "/json": {
                    return headAwareJson(request, { message: "Hello, JSON!" });
                }

                case "/echo": {
                    if (request.method === "HEAD") {
                        return new Response(null, {
                            status: 200,
                            headers: {
                                "content-type": "application/json",
                            },
                        });
                    }

                    const bodyBytes = new Uint8Array(
                        await request.arrayBuffer(),
                    );
                    const bodyText = decoder.decode(bodyBytes);

                    return json(
                        {
                            method: request.method,
                            url: `${url.pathname}${url.search}`,
                            headers,
                            bodyText,
                            bodyLength: bodyBytes.byteLength,
                        },
                        {
                            status: 200,
                            headers: {
                                "content-type": "application/json",
                            },
                        },
                    );
                }

                case "/slow": {
                    await sleep(200);
                    return textResponse("Finally!");
                }

                case "/slow-body": {
                    let sent = 0;

                    const stream = new ReadableStream<Uint8Array>({
                        async pull(controller) {
                            if (sent === 0) {
                                controller.enqueue(encoder.encode("part-1 "));
                                sent = 1;
                                return;
                            }

                            if (sent === 1) {
                                await sleep(200);
                                controller.enqueue(encoder.encode("part-2"));
                                controller.close();
                                sent = 2;
                            }
                        },
                    });

                    return new Response(stream, {
                        status: 200,
                        headers: {
                            "content-type": "text/plain; charset=utf-8",
                        },
                    });
                }

                case "/chunked": {
                    let index = 0;
                    const chunks = ["chunk1", "chunk2", "chunk3"];

                    const stream = new ReadableStream<Uint8Array>({
                        pull(controller) {
                            if (index >= chunks.length) {
                                controller.close();
                                return;
                            }

                            controller.enqueue(encoder.encode(chunks[index]));
                            index += 1;
                        },
                    });

                    return new Response(stream, {
                        status: 200,
                        headers: {
                            "content-type": "text/plain; charset=utf-8",
                        },
                    });
                }

                case "/gzip": {
                    const payload = gzipSync("This is compressed content!");

                    return new Response(payload, {
                        status: 200,
                        headers: {
                            "content-type": "text/plain; charset=utf-8",
                            "content-encoding": "gzip",
                            "content-length": String(payload.byteLength),
                        },
                    });
                }

                case "/bad-gzip": {
                    const payload = encoder.encode("not actually gzip");

                    return new Response(payload, {
                        status: 200,
                        headers: {
                            "content-type": "text/plain; charset=utf-8",
                            "content-encoding": "gzip",
                            "content-length": String(payload.byteLength),
                        },
                    });
                }

                case "/large": {
                    const body = "x".repeat(1024);

                    return textResponse(body, {
                        headers: {
                            "content-length": String(
                                encoder.encode(body).byteLength,
                            ),
                        },
                    });
                }

                case "/large-stream": {
                    let remaining = 32;

                    const stream = new ReadableStream<Uint8Array>({
                        pull(controller) {
                            if (remaining === 0) {
                                controller.close();
                                return;
                            }

                            controller.enqueue(encoder.encode("x".repeat(64)));
                            remaining -= 1;
                        },
                    });

                    return new Response(stream, {
                        status: 200,
                        headers: {
                            "content-type": "text/plain; charset=utf-8",
                        },
                    });
                }

                case "/huge-header": {
                    return new Response("ok", {
                        status: 200,
                        headers: {
                            "content-type": "text/plain; charset=utf-8",
                            "x-huge": "a".repeat(4096),
                        },
                    });
                }

                case "/redirect": {
                    return textResponse("Redirecting to /redirected-target", {
                        status: 302,
                        headers: {
                            location: "/redirected-target",
                        },
                    });
                }

                case "/redirected-target": {
                    return textResponse("You followed the redirect");
                }

                default: {
                    return textResponse("Not Found", { status: 404 });
                }
            }
        },
    });

    return {
        server,
        baseUrl: `http://${server.hostname}:${server.port}`,
        async stop() {
            await server.stop(true);
        },
    };
}

```

### fetch/README.md

```

```

### fetch/package.json

```
{
    "name": "@npy/fetch",
    "module": "src/index.ts",
    "type": "module",
    "license": "MIT",
    "sideEffects": false,
    "scripts": {
        "bench": "node --import=tsx ./benchmarks/index.ts",
        "bench:direct": "node --import=tsx ./benchmarks/direct.ts",
        "bench:proxy": "node --import=tsx ./benchmarks/proxy.ts"
    },
    "exports": {
        ".": "./src/index.ts"
    },
    "devDependencies": {
        "@types/bytes": "^3.1.5",
        "axios": "^1.8.4",
        "got": "^14.4.6",
        "hpagent": "^1.2.0",
        "http-proxy-agent": "^7.0.2",
        "node-fetch": "^3.3.2",
        "proxy-chain": "^2.7.1",
        "undici": "^7.13.0"
    },
    "dependencies": {
        "@fuman/io": "^0.0.19",
        "@fuman/net": "^0.0.19",
        "@fuman/node": "^0.0.19",
        "@fuman/utils": "^0.0.19",
        "@npy/proxy-kit": "workspace:*",
        "bytes": "^3.1.2",
        "generic-pool": "^3.9.0",
        "mitata": "^1.0.34"
    }
}

```

### fetch/tsconfig.json

```
{
    "compilerOptions": {
        // Environment setup & latest features
        "lib": ["ESNext", "DOM", "DOM.Iterable", "DOM.AsyncIterable"],
        "target": "ESNext",
        "module": "esnext",
        "moduleDetection": "force",
        "jsx": "react-jsx",
        "allowJs": true,

        // Bundler mode
        "moduleResolution": "bundler",
        "allowImportingTsExtensions": true,
        "verbatimModuleSyntax": true,
        "noEmit": true,

        // Best practices
        "strict": false,
        "skipLibCheck": true,
        "noFallthroughCasesInSwitch": true,
        "noUncheckedIndexedAccess": true,
        "noImplicitOverride": true,

        // Some stricter flags (disabled by default)
        "noUnusedLocals": false,
        "noUnusedParameters": false,
        "noPropertyAccessFromIndexSignature": false
    }
}

```

### fetch/bun.lock

```
{
  "lockfileVersion": 1,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "@npy/fetch",
      "dependencies": {
        "@fuman/io": "^0.0.19",
        "@fuman/net": "^0.0.19",
        "@fuman/node": "^0.0.19",
        "@fuman/utils": "^0.0.19",
        "bytes": "^3.1.2",
        "generic-pool": "^3.9.0",
      },
      "devDependencies": {
        "@biomejs/biome": "2.4.9",
        "@types/bun": "latest",
        "@types/bytes": "^3.1.5",
      },
      "peerDependencies": {
        "typescript": "^5",
      },
    },
  },
  "packages": {
    "@biomejs/biome": ["@biomejs/biome@2.4.9", "", { "optionalDependencies": { "@biomejs/cli-darwin-arm64": "2.4.9", "@biomejs/cli-darwin-x64": "2.4.9", "@biomejs/cli-linux-arm64": "2.4.9", "@biomejs/cli-linux-arm64-musl": "2.4.9", "@biomejs/cli-linux-x64": "2.4.9", "@biomejs/cli-linux-x64-musl": "2.4.9", "@biomejs/cli-win32-arm64": "2.4.9", "@biomejs/cli-win32-x64": "2.4.9" }, "bin": { "biome": "bin/biome" } }, "sha512-wvZW92FrwitTcacvCBT8xdAbfbxWfDLwjYMmU3djjqQTh7Ni4ZdiWIT/x5VcZ+RQuxiKzIOzi5D+dcyJDFZMsA=="],

    "@biomejs/cli-darwin-arm64": ["@biomejs/cli-darwin-arm64@2.4.9", "", { "os": "darwin", "cpu": "arm64" }, "sha512-d5G8Gf2RpH5pYwiHLPA+UpG3G9TLQu4WM+VK6sfL7K68AmhcEQ9r+nkj/DvR/GYhYox6twsHUtmWWWIKfcfQQA=="],

    "@biomejs/cli-darwin-x64": ["@biomejs/cli-darwin-x64@2.4.9", "", { "os": "darwin", "cpu": "x64" }, "sha512-LNCLNgqDMG7BLdc3a8aY/dwKPK7+R8/JXJoXjCvZh2gx8KseqBdFDKbhrr7HCWF8SzNhbTaALhTBoh/I6rf9lA=="],

    "@biomejs/cli-linux-arm64": ["@biomejs/cli-linux-arm64@2.4.9", "", { "os": "linux", "cpu": "arm64" }, "sha512-4adnkAUi6K4C/emPRgYznMOcLlUqZdXWM6aIui4VP4LraE764g6Q4YguygnAUoxKjKIXIWPteKMgRbN0wsgwcg=="],

    "@biomejs/cli-linux-arm64-musl": ["@biomejs/cli-linux-arm64-musl@2.4.9", "", { "os": "linux", "cpu": "arm64" }, "sha512-8RCww5xnPn2wpK4L/QDGDOW0dq80uVWfppPxHIUg6mOs9B6gRmqPp32h1Ls3T8GnW8Wo5A8u7vpTwz4fExN+sw=="],

    "@biomejs/cli-linux-x64": ["@biomejs/cli-linux-x64@2.4.9", "", { "os": "linux", "cpu": "x64" }, "sha512-L10na7POF0Ks/cgLFNF1ZvIe+X4onLkTi5oP9hY+Rh60Q+7fWzKDDCeGyiHUFf1nGIa9dQOOUPGe2MyYg8nMSQ=="],

    "@biomejs/cli-linux-x64-musl": ["@biomejs/cli-linux-x64-musl@2.4.9", "", { "os": "linux", "cpu": "x64" }, "sha512-5TD+WS9v5vzXKzjetF0hgoaNFHMcpQeBUwKKVi3JbG1e9UCrFuUK3Gt185fyTzvRdwYkJJEMqglRPjmesmVv4A=="],

    "@biomejs/cli-win32-arm64": ["@biomejs/cli-win32-arm64@2.4.9", "", { "os": "win32", "cpu": "arm64" }, "sha512-aDZr0RBC3sMGJOU10BvG7eZIlWLK/i51HRIfScE2lVhfts2dQTreowLiJJd+UYg/tHKxS470IbzpuKmd0MiD6g=="],

    "@biomejs/cli-win32-x64": ["@biomejs/cli-win32-x64@2.4.9", "", { "os": "win32", "cpu": "x64" }, "sha512-NS4g/2G9SoQ4ktKtz31pvyc/rmgzlcIDCGU/zWbmHJAqx6gcRj2gj5Q/guXhoWTzCUaQZDIqiCQXHS7BcGYc0w=="],

    "@fuman/io": ["@fuman/io@0.0.19", "", { "dependencies": { "@fuman/utils": "^0.0.19" } }, "sha512-B+2n3GVa9PCYMJ9xfsdXUlUV9yXO4gKLYfxm815PeJ+MGOw5TbEp166drRmBq1AtxVnP0efy6Oz9rYpKVODgow=="],

    "@fuman/net": ["@fuman/net@0.0.19", "", { "dependencies": { "@fuman/io": "^0.0.19", "@fuman/utils": "^0.0.19" } }, "sha512-yISM+JcZEWBpBYn0v2mUY/Zst4SsicTRaVTvRkVhMiZhgMzdXalfvRwRV/vsgwwL31bntwowCTDW4iilCJLbXg=="],

    "@fuman/node": ["@fuman/node@0.0.19", "", { "dependencies": { "@fuman/io": "^0.0.19", "@fuman/net": "^0.0.19", "@fuman/utils": "^0.0.19" }, "peerDependencies": { "ws": "^8.18.1" }, "optionalPeers": ["ws"] }, "sha512-1VNTBb47yrN5BzuXiP4t6An7mDPklH5N+vUtkeL3XATK+xWbtlQsSsU244T7iqGurmDpYrLM9kIUjdMFm8OhDw=="],

    "@fuman/utils": ["@fuman/utils@0.0.19", "", {}, "sha512-4qVrZ9AjKYztLJsNr1Tp7kL48b22dvVLN1iVW+Me8ZSQ0ILN0qknoxjsczVPReF7+GDWgknNxR2l6ggrA4SZyw=="],

    "@types/bun": ["@types/bun@1.3.11", "", { "dependencies": { "bun-types": "1.3.11" } }, "sha512-5vPne5QvtpjGpsGYXiFyycfpDF2ECyPcTSsFBMa0fraoxiQyMJ3SmuQIGhzPg2WJuWxVBoxWJ2kClYTcw/4fAg=="],

    "@types/bytes": ["@types/bytes@3.1.5", "", {}, "sha512-VgZkrJckypj85YxEsEavcMmmSOIzkUHqWmM4CCyia5dc54YwsXzJ5uT4fYxBQNEXx+oF1krlhgCbvfubXqZYsQ=="],

    "@types/node": ["@types/node@25.5.0", "", { "dependencies": { "undici-types": "~7.18.0" } }, "sha512-jp2P3tQMSxWugkCUKLRPVUpGaL5MVFwF8RDuSRztfwgN1wmqJeMSbKlnEtQqU8UrhTmzEmZdu2I6v2dpp7XIxw=="],

    "bun-types": ["bun-types@1.3.11", "", { "dependencies": { "@types/node": "*" } }, "sha512-1KGPpoxQWl9f6wcZh57LvrPIInQMn2TQ7jsgxqpRzg+l0QPOFvJVH7HmvHo/AiPgwXy+/Thf6Ov3EdVn1vOabg=="],

    "bytes": ["bytes@3.1.2", "", {}, "sha512-/Nf7TyzTx6S3yRJObOAV7956r8cr2+Oj8AC5dt8wSP3BQAoeX58NoHyCU8P8zGkNXStjTSi6fzO6F0pBdcYbEg=="],

    "generic-pool": ["generic-pool@3.9.0", "", {}, "sha512-hymDOu5B53XvN4QT9dBmZxPX4CWhBPPLguTZ9MMFeFa/Kg0xWVfylOVNlJji/E7yTZWFd/q9GO5TxDLq156D7g=="],

    "typescript": ["typescript@5.9.3", "", { "bin": { "tsc": "bin/tsc", "tsserver": "bin/tsserver" } }, "sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw=="],

    "undici-types": ["undici-types@7.18.2", "", {}, "sha512-AsuCzffGHJybSaRrmr5eHr81mwJU3kjw6M+uprWvCXiNeN9SOGwQ3Jn8jb8m3Z6izVgknn1R0FTCEAP2QrLY/w=="],
  }
}

```

### fetch/benchmarks/_infra.ts

```
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import ProxyChain from "proxy-chain";

export const REQUEST_BODY: Uint8Array = new TextEncoder().encode(
    JSON.stringify({ bench: true }),
);

export function pickRandom<T>(arr: readonly T[]): T {
    return arr[Math.floor(Math.random() * arr.length)]!;
}

export interface BenchmarkInfra {
    readonly proxyUrl: string;
    readonly getUrls: readonly string[];
    readonly postUrls: readonly string[];
    close(): Promise<void>;
}

function createOriginServer(name: string): Server {
    return createServer(async (req, res) => {
        const url = new URL(
            req.url ?? "/",
            `http://${req.headers.host ?? "127.0.0.1"}`,
        );

        const sendJson = (status: number, value: unknown) => {
            const body = JSON.stringify(value);
            res.writeHead(status, {
                "content-type": "application/json; charset=utf-8",
                "content-length": String(Buffer.byteLength(body)),
            });
            res.end(body);
        };

        if (req.method === "GET" && url.pathname.startsWith("/get/")) {
            sendJson(200, {
                ok: true,
                origin: name,
                path: url.pathname,
                query: Object.fromEntries(url.searchParams.entries()),
            });
            return;
        }

        if (req.method === "POST" && url.pathname === "/post") {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
                chunks.push(
                    Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
                );
            }

            const body = Buffer.concat(chunks);
            sendJson(200, {
                ok: true,
                origin: name,
                receivedBytes: body.byteLength,
            });
            return;
        }

        sendJson(404, { ok: false });
    });
}

async function listenHttp(server: Server): Promise<number> {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("Failed to get listening port");
    }

    return address.port;
}

async function closeHttp(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

export async function startBenchmarkInfra(): Promise<BenchmarkInfra> {
    const origins = [
        createOriginServer("origin-a"),
        createOriginServer("origin-b"),
        createOriginServer("origin-c"),
    ] as const;

    const originPorts = await Promise.all(origins.map(listenHttp));
    const originBases = originPorts.map((port) => `http://127.0.0.1:${port}`);

    const proxy = new ProxyChain.Server({
        port: 0,
        verbose: false,
        prepareRequestFunction: () => ({
            requestAuthentication: false,
        }),
    });

    await proxy.listen();

    const getUrls = [
        `${originBases[0]}/get/1`,
        `${originBases[0]}/get/2`,
        `${originBases[1]}/get/1`,
        `${originBases[1]}/get/2`,
        `${originBases[2]}/get/1`,
        `${originBases[2]}/get/2`,
    ] as const;

    const postUrls = [
        `${originBases[0]}/post`,
        `${originBases[1]}/post`,
        `${originBases[2]}/post`,
    ] as const;

    return {
        proxyUrl: `http://127.0.0.1:${proxy.port}`,
        getUrls,
        postUrls,
        async close() {
            await proxy.close(true);
            await Promise.all(origins.map(closeHttp));
        },
    };
}

```

### fetch/benchmarks/_clients.ts

```
import { Agent as NodeHttpAgent } from "node:http";
import { Agent as NodeHttpsAgent } from "node:https";
import axios from "axios";
import got from "got";
import {
    HttpProxyAgent as HpHttpProxyAgent,
    HttpsProxyAgent as HpHttpsProxyAgent,
} from "hpagent";
import nodeFetch from "node-fetch";
import {
    Agent as UndiciAgent,
    ProxyAgent as UndiciProxyAgent,
    fetch as undiciFetch,
} from "undici";
import { AutoDialer } from "../src/dialers";
import { ProxyDialer } from "../src/dialers/proxy";
import { createFetch, HttpClient } from "../src/fetch";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface BenchmarkClient {
    readonly name: string;
    get(url: string): Promise<void>;
    post(url: string, body: Uint8Array): Promise<void>;
    close?(): Promise<void>;
}

export interface ClientFactory<Context> {
    readonly name: string;
    create(context: Context): BenchmarkClient;
}

export interface SharedClientContext {
    proxyUrls?: readonly string[];
}

export interface ProxyClientContext {
    proxyUrls: readonly string[];
}

export interface WarmupOptions {
    readonly getUrls: readonly string[];
    readonly postUrls: readonly string[];
    readonly postBody: Uint8Array;
    readonly concurrency: number;
    readonly rounds?: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

type ClosableLike = {
    close?: () => unknown;
    destroy?: (error?: Error) => unknown;
};

type DestroyableAgent = {
    destroy(): void;
};

type ProxySlot = {
    readonly key: string;
    readonly proxyUrl?: string;
};

type NeeopySlot = ProxySlot & {
    readonly client: HttpClient;
    readonly fetchLike: ReturnType<typeof createFetch>;
};

const DEFAULT_CONNECTIONS = 128;
const DEFAULT_KEEPALIVE_TIMEOUT = 30_000;
const DEFAULT_NODE_KEEPALIVE_MSECS = 1_000;
const DEFAULT_NEEOPY_BUFFER_SIZE = 16 * 1024;
const DEFAULT_NEEOPY_MAX_HEADER_SIZE = 64 * 1024;
const DEFAULT_NEEOPY_MAX_BUFFERED_BYTES = 256 * 1024;
const DEFAULT_NEEOPY_MAX_CHUNK_SIZE = 16 * 1024 * 1024;

function assertOk(status: number, name: string): void {
    if (status < 200 || status >= 300) {
        throw new Error(`${name} returned HTTP ${status}`);
    }
}

async function consumeResponse(
    name: string,
    response: Response,
): Promise<void> {
    assertOk(response.status, name);
    await response.arrayBuffer();
}

function destroyAgent(agent: DestroyableAgent): Promise<void> {
    return new Promise((resolve) => {
        agent.destroy();
        resolve();
    });
}

async function closeUndiciDispatcher(dispatcher: ClosableLike): Promise<void> {
    if (typeof dispatcher.close === "function") {
        const result = dispatcher.close();
        if (
            result &&
            typeof (result as PromiseLike<unknown>).then === "function"
        ) {
            await result;
        }
        return;
    }

    if (typeof dispatcher.destroy === "function") {
        const result = dispatcher.destroy();
        if (
            result &&
            typeof (result as PromiseLike<unknown>).then === "function"
        ) {
            await result;
        }
    }
}

function normalizeProxySlots(
    proxyUrls?: readonly string[],
): readonly ProxySlot[] {
    if (!proxyUrls || proxyUrls.length === 0) {
        return [{ key: "direct", proxyUrl: undefined }];
    }

    const unique = Array.from(
        new Set(proxyUrls.map((value) => value.trim()).filter(Boolean)),
    );

    if (unique.length === 0) {
        return [{ key: "direct", proxyUrl: undefined }];
    }

    return unique.map((proxyUrl, index) => ({
        key: `proxy:${index}:${proxyUrl}`,
        proxyUrl,
    }));
}

function createRoundRobin<T>(items: readonly T[]): () => T {
    if (items.length === 0) {
        throw new Error("Round-robin requires at least one item");
    }

    let index = 0;
    return () => {
        const item = items[index];
        index = (index + 1) % items.length;
        return item!;
    };
}

function createDirectHttpAgent(): NodeHttpAgent {
    return new NodeHttpAgent({
        keepAlive: true,
        keepAliveMsecs: DEFAULT_NODE_KEEPALIVE_MSECS,
        maxSockets: DEFAULT_CONNECTIONS,
        maxFreeSockets: DEFAULT_CONNECTIONS,
        scheduling: "lifo",
    });
}

function createDirectHttpsAgent(): NodeHttpsAgent {
    return new NodeHttpsAgent({
        keepAlive: true,
        keepAliveMsecs: DEFAULT_NODE_KEEPALIVE_MSECS,
        maxSockets: DEFAULT_CONNECTIONS,
        maxFreeSockets: DEFAULT_CONNECTIONS,
        scheduling: "lifo",
    });
}

function createProxyHttpAgent(proxyUrl: string): HpHttpProxyAgent {
    return new HpHttpProxyAgent({
        proxy: proxyUrl,
        keepAlive: true,
        keepAliveMsecs: DEFAULT_NODE_KEEPALIVE_MSECS,
        maxSockets: DEFAULT_CONNECTIONS,
        maxFreeSockets: DEFAULT_CONNECTIONS,
        scheduling: "lifo",
    });
}

function createProxyHttpsAgent(proxyUrl: string): HpHttpsProxyAgent {
    return new HpHttpsProxyAgent({
        proxy: proxyUrl,
        keepAlive: true,
        keepAliveMsecs: DEFAULT_NODE_KEEPALIVE_MSECS,
        maxSockets: DEFAULT_CONNECTIONS,
        maxFreeSockets: DEFAULT_CONNECTIONS,
        scheduling: "lifo",
    });
}

function createNeeopyHttpClient(proxyUrl?: string): HttpClient {
    return new HttpClient({
        dialer: proxyUrl ? new ProxyDialer(proxyUrl) : new AutoDialer(),
        poolMaxPerHost: DEFAULT_CONNECTIONS,
        poolMaxIdlePerHost: DEFAULT_CONNECTIONS,
        poolIdleTimeout: DEFAULT_KEEPALIVE_TIMEOUT,
        connect: {
            keepAlive: true,
            noDelay: true,
        },
        io: {
            reader: {
                bufferSize: DEFAULT_NEEOPY_BUFFER_SIZE,
                highWaterMark: DEFAULT_NEEOPY_BUFFER_SIZE,
                maxHeaderSize: DEFAULT_NEEOPY_MAX_HEADER_SIZE,
                maxLineSize: DEFAULT_NEEOPY_MAX_HEADER_SIZE,
                maxBufferedBytes: DEFAULT_NEEOPY_MAX_BUFFERED_BYTES,
                maxChunkSize: DEFAULT_NEEOPY_MAX_CHUNK_SIZE,
                decompress: true,
            },
            writer: {
                highWaterMark: DEFAULT_NEEOPY_BUFFER_SIZE,
                directWriteThreshold: 64 * 1024,
                coalesceBodyMaxBytes: 64 * 1024,
            },
        },
    });
}

function createNeeopySlots(
    proxyUrls?: readonly string[],
): readonly NeeopySlot[] {
    return normalizeProxySlots(proxyUrls).map((slot) => {
        const client = createNeeopyHttpClient(slot.proxyUrl);

        return {
            ...slot,
            client,
            fetchLike: createFetch(client),
        };
    });
}

// ─── @neeopy/fetch ────────────────────────────────────────────────────────────
//
// One HttpClient is created per proxy slot and kept alive for the entire
// process. The HttpClient maintains per-origin AgentPools internally, so
// socket keepalive and connection reuse are fully active across all requests
// that share a slot.

function createNeeopyFetchClient(
    proxyUrls?: readonly string[],
): BenchmarkClient {
    const slots = createNeeopySlots(proxyUrls);
    const next = createRoundRobin(slots);

    return {
        name:
            slots[0]?.proxyUrl != null
                ? "@neeopy/fetch + ProxyDialer"
                : "@neeopy/fetch",
        async get(url) {
            const slot = next();
            const response = await slot.fetchLike(url);
            await consumeResponse(this.name, response);
        },
        async post(url, body) {
            const slot = next();
            const response = await slot.fetchLike(url, {
                method: "POST",
                body,
            });
            await consumeResponse(this.name, response);
        },
        async close() {
            await Promise.all(slots.map((slot) => slot.client.close()));
        },
    };
}

// ─── @neeopy/HttpClient ───────────────────────────────────────────────────────

function createNeeopyRawClient(proxyUrls?: readonly string[]): BenchmarkClient {
    const slots = createNeeopySlots(proxyUrls);
    const next = createRoundRobin(slots);

    return {
        name:
            slots[0]?.proxyUrl != null
                ? "@neeopy/HttpClient + ProxyDialer"
                : "@neeopy/HttpClient",
        async get(url) {
            const slot = next();
            const response = await slot.client.send({
                url,
                method: "GET",
            });
            await consumeResponse(this.name, response);
        },
        async post(url, body) {
            const slot = next();
            const response = await slot.client.send({
                url,
                method: "POST",
                body,
            });
            await consumeResponse(this.name, response);
        },
        async close() {
            await Promise.all(slots.map((slot) => slot.client.close()));
        },
    };
}

// ─── bun:fetch ────────────────────────────────────────────────────────────────

function createBunFetchClient(proxyUrls?: readonly string[]): BenchmarkClient {
    type BunProxyInit = RequestInit & {
        proxy?: string | { url: string };
    };

    const slots = normalizeProxySlots(proxyUrls).map((slot) => ({
        ...slot,
        getInit(): BunProxyInit {
            if (slot.proxyUrl == null) return {};
            return { proxy: { url: slot.proxyUrl } };
        },
        postInit(body: Uint8Array): BunProxyInit {
            if (slot.proxyUrl == null) return { method: "POST", body };
            return { method: "POST", body, proxy: { url: slot.proxyUrl } };
        },
    }));

    const next = createRoundRobin(slots);

    return {
        name: slots[0]?.proxyUrl != null ? "bun:fetch (proxy)" : "bun:fetch",
        async get(url) {
            const slot = next();
            const response = await fetch(url, slot.getInit());
            await consumeResponse(this.name, response);
        },
        async post(url, body) {
            const slot = next();
            const response = await fetch(url, slot.postInit(body));
            await consumeResponse(this.name, response);
        },
    };
}

// ─── undici ───────────────────────────────────────────────────────────────────

function createUndiciClient(proxyUrls?: readonly string[]): BenchmarkClient {
    const slots = normalizeProxySlots(proxyUrls).map((slot) => {
        const dispatcher = slot.proxyUrl
            ? new UndiciProxyAgent({
                  uri: slot.proxyUrl,
                  connections: DEFAULT_CONNECTIONS,
              })
            : new UndiciAgent({
                  connections: DEFAULT_CONNECTIONS,
                  pipelining: 1,
                  keepAliveTimeout: DEFAULT_KEEPALIVE_TIMEOUT,
                  keepAliveMaxTimeout: DEFAULT_KEEPALIVE_TIMEOUT,
              });

        return { ...slot, dispatcher };
    });

    const next = createRoundRobin(slots);

    return {
        name: slots[0]?.proxyUrl != null ? "undici + ProxyAgent" : "undici",
        async get(url) {
            const slot = next();
            const response = await undiciFetch(url, {
                dispatcher: slot.dispatcher,
            });
            await consumeResponse(this.name, response);
        },
        async post(url, body) {
            const slot = next();
            const response = await undiciFetch(url, {
                dispatcher: slot.dispatcher,
                method: "POST",
                body,
            });
            await consumeResponse(this.name, response);
        },
        async close() {
            await Promise.all(
                slots.map((slot) => closeUndiciDispatcher(slot.dispatcher)),
            );
        },
    };
}

// ─── got ──────────────────────────────────────────────────────────────────────

function createGotClient(proxyUrls?: readonly string[]): BenchmarkClient {
    const slots = normalizeProxySlots(proxyUrls).map((slot) => {
        const httpAgent = slot.proxyUrl
            ? createProxyHttpAgent(slot.proxyUrl)
            : createDirectHttpAgent();

        const httpsAgent = slot.proxyUrl
            ? createProxyHttpsAgent(slot.proxyUrl)
            : createDirectHttpsAgent();

        const client = got.extend({
            retry: { limit: 0 },
            throwHttpErrors: false,
            agent: {
                http: httpAgent as unknown as NodeHttpAgent,
                https: httpsAgent as unknown as NodeHttpAgent,
            },
        });

        return { ...slot, httpAgent, httpsAgent, client };
    });

    const next = createRoundRobin(slots);

    return {
        name: slots[0]?.proxyUrl != null ? "got + hpagent" : "got",
        async get(url) {
            const slot = next();
            const response = await slot.client(url, {
                responseType: "buffer",
            });
            assertOk(response.statusCode, this.name);
            void response.rawBody;
        },
        async post(url, body) {
            const slot = next();
            const response = await slot.client.post(url, {
                body: Buffer.from(body),
                responseType: "buffer",
            });
            assertOk(response.statusCode, this.name);
            void response.rawBody;
        },
        async close() {
            await Promise.all(
                slots.flatMap((slot) => [
                    destroyAgent(slot.httpAgent),
                    destroyAgent(slot.httpsAgent),
                ]),
            );
        },
    };
}

// ─── axios ────────────────────────────────────────────────────────────────────

function createAxiosClient(proxyUrls?: readonly string[]): BenchmarkClient {
    const slots = normalizeProxySlots(proxyUrls).map((slot) => {
        const httpAgent = slot.proxyUrl
            ? createProxyHttpAgent(slot.proxyUrl)
            : createDirectHttpAgent();

        const httpsAgent = slot.proxyUrl
            ? createProxyHttpsAgent(slot.proxyUrl)
            : createDirectHttpsAgent();

        const client = axios.create({
            proxy: false,
            httpAgent,
            httpsAgent,
            responseType: "arraybuffer",
            maxRedirects: 0,
            validateStatus: () => true,
        });

        return { ...slot, httpAgent, httpsAgent, client };
    });

    const next = createRoundRobin(slots);

    return {
        name: slots[0]?.proxyUrl != null ? "axios + hpagent" : "axios",
        async get(url) {
            const slot = next();
            const response = await slot.client.get<ArrayBuffer>(url);
            assertOk(response.status, this.name);
            void response.data;
        },
        async post(url, body) {
            const slot = next();
            const response = await slot.client.post<ArrayBuffer>(url, body);
            assertOk(response.status, this.name);
            void response.data;
        },
        async close() {
            await Promise.all(
                slots.flatMap((slot) => [
                    destroyAgent(slot.httpAgent),
                    destroyAgent(slot.httpsAgent),
                ]),
            );
        },
    };
}

// ─── node-fetch ───────────────────────────────────────────────────────────────

function createNodeFetchClient(proxyUrls?: readonly string[]): BenchmarkClient {
    const slots = normalizeProxySlots(proxyUrls).map((slot) => {
        const httpAgent = slot.proxyUrl
            ? createProxyHttpAgent(slot.proxyUrl)
            : createDirectHttpAgent();

        const httpsAgent = slot.proxyUrl
            ? createProxyHttpsAgent(slot.proxyUrl)
            : createDirectHttpsAgent();

        const selectAgent = (parsedUrl: URL): NodeHttpAgent =>
            parsedUrl.protocol === "https:"
                ? (httpsAgent as unknown as NodeHttpAgent)
                : (httpAgent as unknown as NodeHttpAgent);

        return { ...slot, httpAgent, httpsAgent, selectAgent };
    });

    const next = createRoundRobin(slots);

    return {
        name:
            slots[0]?.proxyUrl != null ? "node-fetch + hpagent" : "node-fetch",
        async get(url) {
            const slot = next();
            const response = await nodeFetch(url, {
                agent: slot.selectAgent as never,
            });
            assertOk(response.status, this.name);
            await response.arrayBuffer();
        },
        async post(url, body) {
            const slot = next();
            const response = await nodeFetch(url, {
                agent: slot.selectAgent as never,
                method: "POST",
                body,
            });
            assertOk(response.status, this.name);
            await response.arrayBuffer();
        },
        async close() {
            await Promise.all(
                slots.flatMap((slot) => [
                    destroyAgent(slot.httpAgent),
                    destroyAgent(slot.httpsAgent),
                ]),
            );
        },
    };
}

// ─── Factory lists ────────────────────────────────────────────────────────────

const HAS_BUN_RUNTIME = typeof Bun !== "undefined";

export const DIRECT_CLIENT_FACTORIES: readonly ClientFactory<SharedClientContext>[] =
    [
        {
            name: "@neeopy/fetch",
            create: ({ proxyUrls }) => createNeeopyFetchClient(proxyUrls),
        },
        {
            name: "@neeopy/HttpClient",
            create: ({ proxyUrls }) => createNeeopyRawClient(proxyUrls),
        },
        ...(HAS_BUN_RUNTIME
            ? [
                  {
                      name: "bun:fetch",
                      create: ({ proxyUrls }: SharedClientContext) =>
                          createBunFetchClient(proxyUrls),
                  },
              ]
            : []),
        {
            name: "undici",
            create: ({ proxyUrls }) => createUndiciClient(proxyUrls),
        },
        {
            name: "got",
            create: ({ proxyUrls }) => createGotClient(proxyUrls),
        },
        {
            name: "axios",
            create: ({ proxyUrls }) => createAxiosClient(proxyUrls),
        },
        {
            name: "node-fetch",
            create: ({ proxyUrls }) => createNodeFetchClient(proxyUrls),
        },
    ] as const;

export const PROXY_CLIENT_FACTORIES: readonly ClientFactory<ProxyClientContext>[] =
    [
        {
            name: "@neeopy/fetch + ProxyDialer",
            create: ({ proxyUrls }) => createNeeopyFetchClient(proxyUrls),
        },
        {
            name: "@neeopy/HttpClient + ProxyDialer",
            create: ({ proxyUrls }) => createNeeopyRawClient(proxyUrls),
        },
        ...(HAS_BUN_RUNTIME
            ? [
                  {
                      name: "bun:fetch (proxy)",
                      create: ({ proxyUrls }: ProxyClientContext) =>
                          createBunFetchClient(proxyUrls),
                  },
              ]
            : []),
        {
            name: "undici + ProxyAgent",
            create: ({ proxyUrls }) => createUndiciClient(proxyUrls),
        },
        {
            name: "got + hpagent",
            create: ({ proxyUrls }) => createGotClient(proxyUrls),
        },
        {
            name: "axios + hpagent",
            create: ({ proxyUrls }) => createAxiosClient(proxyUrls),
        },
        {
            name: "node-fetch + hpagent",
            create: ({ proxyUrls }) => createNodeFetchClient(proxyUrls),
        },
    ] as const;

// ─── Lifecycle helpers ────────────────────────────────────────────────────────

export function createClients<Context>(
    factories: readonly ClientFactory<Context>[],
    context: Context,
): Map<string, BenchmarkClient> {
    return new Map(
        factories.map((factory) => [factory.name, factory.create(context)]),
    );
}

export async function closeClients(
    clients: Map<string, BenchmarkClient>,
): Promise<void> {
    await Promise.all(
        Array.from(clients.values(), async (client) => {
            await client.close?.();
        }),
    );
}

export async function warmupClients(
    clients: Map<string, BenchmarkClient>,
    options: WarmupOptions,
): Promise<void> {
    const { getUrls, postUrls, postBody, concurrency, rounds = 2 } = options;

    const parallelism = Math.max(1, concurrency);

    for (const client of clients.values()) {
        const nextGet = createRoundRobin(getUrls);
        const nextPost = createRoundRobin(postUrls);

        for (let round = 0; round < rounds; round += 1) {
            await Promise.all(
                Array.from({ length: parallelism }, () =>
                    client.get(nextGet()),
                ),
            );

            await Promise.all(
                Array.from({ length: parallelism }, () =>
                    client.post(nextPost(), postBody),
                ),
            );
        }
    }
}

```

### fetch/benchmarks/direct.ts

```
import { DIRECT_CLIENT_FACTORIES } from "./_clients";
import { runScenario } from "./_runner";

await runScenario({
    title: "Direct HTTP benchmarks",
    factories: DIRECT_CLIENT_FACTORIES,
    createContext() {
        return {
            proxyUrls: [],
        };
    },
});

```

### fetch/benchmarks/proxy.ts

```
import { PROXY_CLIENT_FACTORIES } from "./_clients";
import { runScenario } from "./_runner";

await runScenario({
    title: "HTTP proxy benchmarks",
    factories: PROXY_CLIENT_FACTORIES,
    createContext(infra) {
        return {
            proxyUrls: [infra.proxyUrl],
        };
    },
});

```

### fetch/benchmarks/index.ts

```
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scripts = [
    fileURLToPath(new URL("./direct.ts", import.meta.url)),
    fileURLToPath(new URL("./proxy.ts", import.meta.url)),
] as const;

for (const script of scripts) {
    const proc = spawn(process.execPath, ["--import=tsx", script], {
        stdio: "inherit",
        env: process.env,
    });

    const exitCode = await new Promise<number>((resolve, reject) => {
        proc.once("error", reject);
        proc.once("exit", (code, signal) => {
            if (signal) {
                resolve(1);
                return;
            }

            resolve(code ?? 0);
        });
    });

    if (exitCode !== 0) {
        process.exit(exitCode);
    }
}

```

### fetch/benchmarks/_runner.ts

```
import { bench, run, summary } from "mitata";
import {
    type BenchmarkClient,
    type ClientFactory,
    closeClients,
    createClients,
    warmupClients,
} from "./_clients";
import {
    type BenchmarkInfra,
    REQUEST_BODY,
    startBenchmarkInfra,
} from "./_infra";

const DEFAULT_CONCURRENCY = 16;
const DEFAULT_WARMUP_ROUNDS = 2;

export interface Scenario<Context> {
    readonly title: string;
    readonly factories: readonly ClientFactory<Context>[];
    createContext(infra: BenchmarkInfra): Context;
}

function getEnvNumber(name: string, fallback: number): number {
    const value = process.env[name];
    if (!value) return fallback;

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getEnvRegex(name: string): RegExp | undefined {
    const value = process.env[name]?.trim();
    if (!value) return undefined;

    try {
        return new RegExp(value);
    } catch (error) {
        throw new Error(`Invalid regex in ${name}: ${value}`, { cause: error });
    }
}

function printHeader(title: string): void {
    console.log("");
    console.log("=".repeat(title.length));
    console.log(title);
    console.log("=".repeat(title.length));
}

function createRoundRobin<T>(items: readonly T[]): () => T {
    if (items.length === 0) {
        throw new Error("Round-robin requires at least one item");
    }

    let index = 0;
    return () => {
        const item = items[index];
        index = (index + 1) % items.length;
        return item!;
    };
}

function registerAsyncBench(
    name: string,
    concurrency: number,
    fn: () => Promise<void>,
): void {
    bench(name, function* () {
        yield {
            concurrency,
            async bench() {
                await fn();
            },
        };
    }).gc(false);
}

export async function runScenario<Context>(
    scenario: Scenario<Context>,
): Promise<void> {
    const concurrency = getEnvNumber(
        "BENCH_CONCURRENCY",
        getEnvNumber("BENCH_BATCH_SIZE", DEFAULT_CONCURRENCY),
    );
    const warmupRounds = getEnvNumber(
        "BENCH_WARMUP_ROUNDS",
        DEFAULT_WARMUP_ROUNDS,
    );
    const filter = getEnvRegex("BENCH_FILTER");

    const infra = await startBenchmarkInfra();
    const clients = createClients(
        scenario.factories,
        scenario.createContext(infra),
    );

    try {
        console.log("Warming up clients...");
        await warmupClients(clients, {
            getUrls: infra.getUrls,
            postUrls: infra.postUrls,
            postBody: REQUEST_BODY,
            concurrency,
            rounds: warmupRounds,
        });

        printHeader(scenario.title);
        console.log(`concurrency=${concurrency}`);
        console.log(`warmupRounds=${warmupRounds}`);
        if (filter) {
            console.log(`filter=${filter}`);
        }

        summary(() => {
            registerGetBenchmarks(clients, concurrency, infra.getUrls);
            registerPostBenchmarks(clients, concurrency, infra.postUrls);
        });

        await run({
            throw: true,
            ...(filter ? { filter } : {}),
        });
    } finally {
        await closeClients(clients);
        await infra.close();
    }
}

function registerGetBenchmarks(
    clients: Map<string, BenchmarkClient>,
    concurrency: number,
    getUrls: readonly string[],
): void {
    for (const client of clients.values()) {
        const nextUrl = createRoundRobin(getUrls);

        registerAsyncBench(`${client.name} :: GET`, concurrency, () =>
            client.get(nextUrl()),
        );
    }
}

function registerPostBenchmarks(
    clients: Map<string, BenchmarkClient>,
    concurrency: number,
    postUrls: readonly string[],
): void {
    for (const client of clients.values()) {
        const nextUrl = createRoundRobin(postUrls);

        registerAsyncBench(`${client.name} :: POST`, concurrency, () =>
            client.post(nextUrl(), REQUEST_BODY),
        );
    }
}

```

