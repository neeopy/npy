import {
    type ProxyInfo,
    parse as parseProxy,
    stringify as stringifyProxy,
} from "@npy/proxy-kit";
import { toWebBodyReadError, toWebFetchError } from "./_internal/error-mapping";
import {
    isBlob,
    isFormData,
    isIterable,
    isMultipartFormDataStream,
    isReadable,
    isReadableStream,
    isURLSearchParameters,
} from "./_internal/guards";
import { bodyErrorMapperSymbol } from "./_internal/symbols";
import { type BodyInit as FetchBodyInit, fromRequestBody } from "./body";
import { AutoDialer, ProxyDialer } from "./dialers";
import type { HttpClientOptions } from "./http-client";
import { HttpClient } from "./http-client";

const MAX_REDIRECTS = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_REDIRECT_HEADERS = [
    "authorization",
    "cookie",
    "proxy-authorization",
] as const;
const BODY_HEADERS = [
    "content-encoding",
    "content-language",
    "content-length",
    "content-location",
    "content-type",
    "transfer-encoding",
] as const;

export type FetchProxyInput = string | ProxyInfo | null;

export interface RequestInit
    extends Omit<globalThis.RequestInit, "body" | "headers"> {
    body?: FetchBodyInit | null;
    headers?: HeadersInit;
    client?: HttpClient;
    proxy?: FetchProxyInput;
}

export type FetchRequestInit = RequestInit;
export interface FetchOptions extends HttpClientOptions {}

export interface FetchLike {
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    close(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
    readonly client: HttpClient;
}

interface PreparedRequest {
    url: URL;
    method: string;
    headers: Headers;
    body: FetchBodyInit | null | undefined;
    signal?: AbortSignal;
    redirect: RequestRedirect;
    baseClient: HttpClient;
    proxy: FetchProxyInput | undefined;
    replayBodyRequest?: Request;
}

interface NormalizedProxyConfig {
    key: string;
    proxy: ProxyInfo;
}

function createDefaultHttpClient(options: FetchOptions = {}): HttpClient {
    return new HttpClient({
        ...options,
        dialer: options.dialer ?? new AutoDialer(),
    });
}

/**
 * Normalizes any supported header input into a {@link Headers} instance.
 *
 * @remarks
 * If the input is already a {@link Headers} object, the same instance is returned.
 * Tuple arrays and plain records are copied into a new {@link Headers}.
 */
export function normalizeHeaders(headers?: HeadersInit): Headers {
    if (headers instanceof Headers) return headers;

    const result = new Headers();
    if (!headers) return result;

    if (Array.isArray(headers)) {
        for (const [key, value] of headers) result.append(key, value);
        return result;
    }

    for (const [key, value] of Object.entries(headers)) {
        if (Array.isArray(value)) {
            for (const entry of value) result.append(key, entry);
        } else if (value !== undefined) {
            result.append(key, value);
        }
    }

    return result;
}

function resolveUrl(input: RequestInfo | URL): URL {
    if (input instanceof URL) return input;
    return new URL(input instanceof Request ? input.url : String(input));
}

function resolveMethod(input: RequestInfo | URL, init: RequestInit): string {
    const raw =
        init.method ?? (input instanceof Request ? input.method : undefined);
    return raw?.toUpperCase().trim() ?? "GET";
}

function resolveHeaders(input: RequestInfo | URL, init: RequestInit): Headers {
    const headersSource =
        init.headers !== undefined
            ? init.headers
            : input instanceof Request
              ? input.headers
              : undefined;
    return normalizeHeaders(headersSource);
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
    if (init.body !== undefined) return init.body;
    return input instanceof Request ? fromRequestBody(input) : undefined;
}

function resolveRedirectMode(
    input: RequestInfo | URL,
    init: RequestInit,
): RequestRedirect {
    return (
        init.redirect ?? (input instanceof Request ? input.redirect : "follow")
    );
}

function getBodyReplaySource(
    input: RequestInfo | URL,
    init: RequestInit,
    method: string,
    body: FetchBodyInit | null | undefined,
    redirect: RequestRedirect,
): Request | undefined {
    if (
        redirect !== "follow" ||
        init.body !== undefined ||
        body == null ||
        method === "GET" ||
        method === "HEAD" ||
        !(input instanceof Request)
    ) {
        return undefined;
    }
    return input.clone();
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

function lookupEnvProxy(...names: string[]): string | undefined {
    for (const name of names) {
        const value = process.env[name] ?? process.env[name.toLowerCase()];
        const normalized = value?.trim();
        if (normalized) return normalized;
    }
    return undefined;
}

function resolveProxyFromEnv(url: URL): string | undefined {
    const socksProxy = lookupEnvProxy("SOCKS5_PROXY", "SOCKS_PROXY");
    if (socksProxy) return socksProxy;
    if (url.protocol === "https:")
        return lookupEnvProxy("HTTPS_PROXY", "HTTP_PROXY");
    return lookupEnvProxy("HTTP_PROXY");
}

function normalizeProxyConfig(
    proxy: Exclude<FetchProxyInput, null>,
): NormalizedProxyConfig {
    const parsed =
        typeof proxy === "string" ? parseProxy(proxy, { strict: true }) : proxy;
    if (parsed == null)
        throw new TypeError(`Invalid proxy string: ${String(proxy)}`);

    const key = stringifyProxy(parsed, {
        strict: true,
        format: "user:pass@ip:port",
    });
    if (!key) throw new TypeError("Failed to normalize proxy configuration");

    return { key, proxy: parsed };
}

function resolveNormalizedProxy(
    url: URL,
    proxy: FetchProxyInput | undefined,
): NormalizedProxyConfig | null {
    if (proxy === null) return null;
    if (proxy !== undefined) return normalizeProxyConfig(proxy);
    const envProxy = resolveProxyFromEnv(url);
    return envProxy ? normalizeProxyConfig(envProxy) : null;
}

function annotateResponse(
    response: Response,
    url: string,
    redirected: boolean,
): Response {
    try {
        if (redirected) {
            Object.defineProperties(response, {
                redirected: {
                    configurable: true,
                    enumerable: true,
                    value: true,
                    writable: false,
                },
                url: {
                    configurable: true,
                    enumerable: true,
                    value: url,
                    writable: false,
                },
            });
        } else {
            Object.defineProperty(response, "url", {
                configurable: true,
                enumerable: true,
                value: url,
                writable: false,
            });
        }
    } catch {}
    return response;
}

async function discardResponse(response: Response): Promise<void> {
    try {
        await response.body?.cancel();
    } catch {}
}

function isRedirectResponse(response: Response): boolean {
    return (
        REDIRECT_STATUSES.has(response.status) &&
        response.headers.get("location") != null
    );
}

function isReplayableBody(body: FetchBodyInit | null | undefined): boolean {
    if (
        body == null ||
        typeof body === "string" ||
        body instanceof Uint8Array ||
        isBlob(body) ||
        isFormData(body) ||
        isURLSearchParameters(body)
    ) {
        return true;
    }
    if (
        isReadableStream(body) ||
        isReadable(body) ||
        isMultipartFormDataStream(body) ||
        isIterable(body)
    ) {
        return false;
    }
    return true;
}

async function resolveReplayableBody(
    current: PreparedRequest,
): Promise<FetchBodyInit | null | undefined> {
    if (isReplayableBody(current.body)) return current.body;
    if (current.replayBodyRequest) {
        const buffer = await current.replayBodyRequest.arrayBuffer();
        return buffer.byteLength > 0 ? new Uint8Array(buffer) : null;
    }
    throw new TypeError(
        "Cannot follow redirect with a non-replayable request body",
    );
}

function shouldDropBodyOnRedirect(status: number, method: string): boolean {
    if (status === 303) return method !== "HEAD";
    return (status === 301 || status === 302) && method === "POST";
}

function resolveRedirectMethod(status: number, method: string): string {
    if (
        (status === 303 && method !== "HEAD") ||
        ((status === 301 || status === 302) && method === "POST")
    ) {
        return "GET";
    }
    return method;
}

function createRedirectHeaders(
    current: PreparedRequest,
    nextUrl: URL,
    dropBody: boolean,
): Headers {
    const headers = new Headers(current.headers);
    const isCrossOrigin = current.url.origin !== nextUrl.origin;
    const isDowngrade =
        current.url.protocol === "https:" && nextUrl.protocol === "http:";

    headers.delete("host");
    if (isCrossOrigin) {
        for (const name of SENSITIVE_REDIRECT_HEADERS) headers.delete(name);
    }
    if (dropBody) {
        for (const name of BODY_HEADERS) headers.delete(name);
    }
    if (!headers.has("referer") && !isDowngrade) {
        headers.set("referer", current.url.toString());
    }
    return headers;
}

async function buildRedirectRequest(
    current: PreparedRequest,
    response: Response,
): Promise<PreparedRequest> {
    const location = response.headers.get("location");
    if (!location) return current;

    const nextUrl = new URL(location, current.url);
    const nextMethod = resolveRedirectMethod(response.status, current.method);
    const dropBody = shouldDropBodyOnRedirect(response.status, current.method);
    const nextHeaders = createRedirectHeaders(current, nextUrl, dropBody);
    const nextBody = dropBody
        ? undefined
        : await resolveReplayableBody(current);

    return {
        ...current,
        url: nextUrl,
        method: nextMethod,
        headers: nextHeaders,
        body: nextBody,
        replayBodyRequest: undefined,
    };
}

async function sendPreparedRequest(
    prepared: PreparedRequest,
    getProxyClient: (
        baseClient: HttpClient,
        proxy: NormalizedProxyConfig,
    ) => HttpClient,
): Promise<Response> {
    assertValidFetchUrl(prepared.url);
    assertValidFetchBody(prepared.method, prepared.body);

    const normalizedProxy = resolveNormalizedProxy(
        prepared.url,
        prepared.proxy,
    );
    const client = normalizedProxy
        ? getProxyClient(prepared.baseClient, normalizedProxy)
        : prepared.baseClient;

    try {
        const sendOptions = Object.defineProperty(
            {
                url: prepared.url,
                method: prepared.method,
                headers: prepared.headers,
                body: prepared.body ?? null,
                signal: prepared.signal,
            },
            bodyErrorMapperSymbol,
            {
                configurable: false,
                enumerable: false,
                writable: false,
                value: (error: unknown) =>
                    toWebBodyReadError(error, prepared.signal),
            },
        );

        return await client.send(sendOptions);
    } catch (error) {
        throw toWebFetchError(error, prepared.signal);
    }
}

function prepareRequest(
    input: RequestInfo | URL,
    init: RequestInit,
    defaultHttpClient: HttpClient,
): PreparedRequest {
    const url = resolveUrl(input);
    const method = resolveMethod(input, init);
    const headers = resolveHeaders(input, init);
    const body = resolveBody(input, init);
    const signal = resolveSignal(input, init);
    const redirect = resolveRedirectMode(input, init);

    return {
        url,
        method,
        headers,
        body,
        signal,
        redirect,
        baseClient: init.client ?? defaultHttpClient,
        proxy: init.proxy,
        replayBodyRequest: getBodyReplaySource(
            input,
            init,
            method,
            body,
            redirect,
        ),
    };
}

/**
 * Creates a fetch-compatible client backed by {@link HttpClient}.
 *
 * @remarks
 * The returned function follows the standard fetch shape, but uses this library's
 * connection pooling, proxy support and body/error mapping rules.
 *
 * When no client is provided, an internal {@link HttpClient} is created and owned
 * by the returned fetch-like function. Calling {@link FetchLike.close} closes that
 * internal client and any proxy-specific clients created on demand.
 *
 * @example
 * ```ts
 * const fetchLike = createFetch();
 * const response = await fetchLike("https://httpbin.org/anything");
 * const data = await response.json();
 * await fetchLike.close();
 * ```
 */
export function createFetch(client?: HttpClient): FetchLike {
    const defaultHttpClient = client ?? createDefaultHttpClient();
    const proxyClientsByBase = new WeakMap<
        HttpClient,
        Map<string, HttpClient>
    >();
    const ownedProxyClients = new Set<HttpClient>();

    let closePromise: Promise<void> | undefined;

    const getProxyClient = (
        baseClient: HttpClient,
        proxy: NormalizedProxyConfig,
    ): HttpClient => {
        let clients = proxyClientsByBase.get(baseClient);
        if (!clients) {
            clients = new Map();
            proxyClientsByBase.set(baseClient, clients);
        }

        const existing = clients.get(proxy.key);
        if (existing) return existing;

        const proxyClient = new HttpClient({
            ...baseClient.options,
            dialer: new ProxyDialer(proxy.proxy),
        });

        clients.set(proxy.key, proxyClient);
        ownedProxyClients.add(proxyClient);
        return proxyClient;
    };

    const fetchLike = (async (
        input: RequestInfo | URL,
        init: RequestInit = {},
    ): Promise<Response> => {
        let prepared = prepareRequest(input, init, defaultHttpClient);
        let redirected = false;
        let redirects = 0;

        for (;;) {
            const response = await sendPreparedRequest(
                prepared,
                getProxyClient,
            );

            if (
                !isRedirectResponse(response) ||
                prepared.redirect === "manual"
            ) {
                return annotateResponse(
                    response,
                    prepared.url.toString(),
                    redirected,
                );
            }

            if (prepared.redirect === "error") {
                await discardResponse(response);
                throw new TypeError(
                    `fetch failed: redirect mode is set to "error"`,
                );
            }

            if (redirects >= MAX_REDIRECTS) {
                await discardResponse(response);
                throw new TypeError(
                    `fetch failed: maximum redirect count exceeded`,
                );
            }

            prepared = await buildRedirectRequest(prepared, response);
            await discardResponse(response);
            redirected = true;
            redirects += 1;
        }
    }) as FetchLike;

    const close = async (): Promise<void> => {
        if (closePromise) return closePromise;

        const promise = (async () => {
            const proxyClients = Array.from(ownedProxyClients);
            ownedProxyClients.clear();

            const results = await Promise.allSettled([
                ...proxyClients.map((c) => c.close()),
                ...(client == null ? [defaultHttpClient.close()] : []),
            ]);

            const errors = results.flatMap((result) =>
                result.status === "rejected" ? [result.reason] : [],
            );

            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) {
                throw new AggregateError(
                    errors,
                    "Failed to close one or more fetch clients",
                );
            }
        })();

        closePromise = promise;

        try {
            await promise;
        } finally {
            if (closePromise === promise) closePromise = undefined;
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

export type { HttpClientOptions, ProxyInfo };
export { HttpClient };

/**
 * Default fetch-compatible client created with {@link createFetch}.
 *
 * @remarks
 * This singleton owns its internal {@link HttpClient}. Call {@link FetchLike.close}
 * when you want to release pooled connections explicitly.
 */
export const fetch: FetchLike = createFetch();
export default fetch;
