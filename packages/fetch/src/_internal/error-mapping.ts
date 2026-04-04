import { DecodeStreamError } from "../_internal/decode-stream-error";
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

/** Casts or converts the unknown into an Error */
export function unknownToError(err: unknown): Error {
    if (err instanceof Error) {
        return err;
    }

    if (typeof err === "string") {
        return new Error(err);
    }

    return new Error("unknown error", { cause: err });
}

function isAbortOrTimeoutError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }

    const name = String((error as { name?: unknown }).name ?? "");
    return name === "AbortError" || name === "TimeoutError";
}

export function toConnectError(
    error: unknown,
    {
        signal,
        context,
        timedOut,
    }: {
        signal?: AbortSignal;
        context?: FetchErrorContext;
        timedOut?: boolean;
    },
): FetchError {
    if (error instanceof FetchError) return error;

    if (timedOut || signal?.reason?.name === "TimeoutError") {
        return new ConnectTimeoutError(
            unknownToError(error),
            context,
            "Connection timeout",
        );
    }

    if (signal?.aborted || isAbortOrTimeoutError(error)) {
        return new RequestAbortedError(
            unknownToError(
                signal?.reason ??
                    error ??
                    new DOMException(
                        "This operation was aborted",
                        "AbortError",
                    ),
            ),
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

export function toSendError(
    error: unknown,
    {
        signal,
        context,
        phase,
    }: {
        signal?: AbortSignal;
        context?: FetchErrorContext;
        phase: "request" | "response" | "body";
    },
): FetchError {
    if (error instanceof FetchError) return error;

    if (signal?.aborted || isAbortOrTimeoutError(error)) {
        return new RequestAbortedError(
            unknownToError(
                signal?.reason ??
                    error ??
                    new DOMException(
                        "This operation was aborted",
                        "AbortError",
                    ),
            ),
            context,
            phase === "body"
                ? "The request was aborted while reading the response body"
                : "The request was aborted",
        );
    }

    const cause = unknownToError(error);

    if (phase === "request") return new RequestWriteError(cause, context);
    if (phase === "response") return new ResponseHeaderError(cause, context);

    if (error instanceof DecodeStreamError) {
        return new ResponseDecodeError(unknownToError(error.cause), context);
    }

    return new ResponseBodyError(cause, context);
}

export function toWebFetchError(error: unknown, signal?: AbortSignal): unknown {
    if (signal?.aborted) {
        return (
            signal.reason ??
            new DOMException("This operation was aborted", "AbortError")
        );
    }

    if (error instanceof DOMException || error instanceof TypeError) {
        return error;
    }

    return new TypeError("fetch failed", { cause: unknownToError(error) });
}

export function toWebBodyReadError(
    error: unknown,
    signal?: AbortSignal,
): unknown {
    if (signal?.aborted) {
        return (
            signal.reason ??
            new DOMException("This operation was aborted", "AbortError")
        );
    }

    if (
        error instanceof DOMException ||
        error instanceof TypeError ||
        error instanceof RangeError
    ) {
        return error;
    }

    return new TypeError("Failed to read response body", {
        cause: unknownToError(error),
    });
}
