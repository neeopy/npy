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
