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

function toArrayBufferBytes(
    bytes: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
    if (bytes.buffer instanceof ArrayBuffer) {
        return bytes as Uint8Array<ArrayBuffer>;
    }
    return new Uint8Array(bytes);
}

function wrapStreamErrors(
    source: ReadableStream<Uint8Array>,
    mapError: (err: unknown) => unknown,
): ReadableStream<Uint8Array> {
    const reader = source.getReader();
    let pending: Uint8Array | null = null;

    return new ReadableStream({
        type: "bytes",
        async pull(controller) {
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

                        if (!value || value.byteLength === 0) continue;

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
                    controller.enqueue(toArrayBufferBytes(chunk));
                    return;
                }

                const { done, value } = await reader.read();

                if (done) {
                    controller.close();
                    return;
                }

                if (value && value.byteLength > 0) {
                    controller.enqueue(toArrayBufferBytes(value));
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
}

export async function readResponse(
    conn: IConnection<unknown>,
    options: Readers.Options & LineReader.ReadHeadersOptions = {},
    shouldIgnoreBody: (status: number) => boolean,
    onDone?: (reusable: boolean) => void,

    mapBodyError?: (err: unknown) => unknown,
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
        : new BodyReader(lr, contentLength, options);

    const rawBody = new ReadableStream({
        type: "bytes",
        async pull(controller: ReadableByteStreamController) {
            const byob = controller.byobRequest;
            const view = byob?.view
                ? new Uint8Array(
                      byob.view.buffer,
                      byob.view.byteOffset,
                      byob.view.byteLength,
                  )
                : new Uint8Array(
                      new ArrayBuffer(options.readChunkSize ?? 16 * 1024),
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

        if (mapBodyError != null) {
            body = wrapStreamErrors(body, mapBodyError);
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
