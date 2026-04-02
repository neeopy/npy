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
