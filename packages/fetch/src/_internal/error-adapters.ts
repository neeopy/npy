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
