import { Deferred } from "@fuman/utils";
import { toConnectError, toSendError } from "./_internal/error-mapping";
import { raceSignal } from "./_internal/promises";
import { bodyErrorMapperSymbol } from "./_internal/symbols";
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
import type { Agent } from "./types/agent";
import type { Dialer } from "./types/dialer";

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
    conn: Dialer.ConnectionLike,
): conn is Dialer.ConnectionLike & { getAlpnProtocol(): string | null } {
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

    const target: Dialer.Target = {
        address: hostname,
        port,
        secure,
        sni: secure ? hostname : undefined,
        alpnProtocols: secure ? [...DEFAULT_ALPN_PROTOCOLS] : undefined,
    };

    const connectOptions = options.connect ?? {};
    const readerOptions = options.io?.reader ?? {};
    const writerOptions = options.io?.writer ?? {};

    let conn: Dialer.ConnectionLike | undefined;
    let connectPromise: Promise<Dialer.ConnectionLike> | undefined;

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
        if (!isBusy) markIdle();
    }

    function assertUsable(): void {
        if (closed) throw new AgentClosedError(createBaseErrorContext());
    }

    function assertSameOrigin(url: URL): void {
        if (url.origin !== base.origin) {
            throw new OriginMismatchError(base.origin, url.origin, {
                ...createBaseErrorContext(),
                url: url.toString(),
            });
        }
    }

    function configureConnection(nextConn: Dialer.ConnectionLike): void {
        nextConn.setNoDelay(connectOptions.noDelay ?? true);
        if (connectOptions.keepAlive !== null) {
            nextConn.setKeepAlive(connectOptions.keepAlive ?? true);
        }
    }

    async function connect(
        signal?: AbortSignal,
    ): Promise<Dialer.ConnectionLike> {
        assertUsable();
        if (conn) return conn;
        if (connectPromise) return withSignal(connectPromise, signal);

        let timedOut = false;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const abortController = new AbortController();

        const onAbort = () => abortController.abort(signal?.reason);
        const cleanup = () => {
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
                timeoutId = undefined;
            }
            if (signal) signal.removeEventListener("abort", onAbort);
        };

        if (signal) {
            if (signal.aborted) abortController.abort(signal.reason);
            else signal.addEventListener("abort", onAbort, { once: true });
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
                throw toConnectError(error, {
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

    async function executeRequest(
        sendOptions: Agent.SendOptions,
        mapBodyError?: (err: unknown) => unknown,
    ): Promise<Response> {
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
        if (isBusy) throw new AgentBusyError(errorContext);
        assertSameOrigin(url);
        if (method === "CONNECT")
            throw new UnsupportedMethodError("CONNECT", errorContext);

        isBusy = true;
        idleDeferred = new Deferred<void>();

        let finalized = false;
        let activeConn: Dialer.ConnectionLike | undefined;

        const finalize = (reusable: boolean) => {
            if (finalized) return;
            finalized = true;
            if (!reusable || closed) {
                if (conn === activeConn) disposeConn();
                else if (activeConn) {
                    try {
                        activeConn.close();
                    } catch {}
                }
            }
            markIdle();
        };

        const abortListener = () => {
            if (activeConn) {
                if (conn === activeConn) conn = undefined;
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
                throw toSendError(error, {
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
                        mapBodyError,
                    ),
                    sendOptions.signal,
                );
            } catch (error) {
                throw toSendError(error, {
                    signal: sendOptions.signal,
                    context: errorContext,
                    phase: "response",
                });
            }

            return response;
        } catch (error) {
            sendOptions.signal?.removeEventListener("abort", abortListener);

            if (activeConn) {
                if (conn === activeConn) conn = undefined;
                try {
                    activeConn.close();
                } catch {}
            }

            finalize(false);
            throw error;
        }
    }

    async function send(sendOptions: Agent.SendOptions): Promise<Response> {
        const url =
            typeof sendOptions.url === "string"
                ? new URL(sendOptions.url)
                : sendOptions.url;
        const errorContext = createRequestErrorContext(
            url,
            sendOptions.method.toUpperCase(),
        );

        const mapBodyError =
            (
                sendOptions as {
                    [bodyErrorMapperSymbol]?: (err: unknown) => unknown;
                }
            )[bodyErrorMapperSymbol] ??
            ((error: unknown) =>
                toSendError(error, {
                    signal: sendOptions.signal,
                    context: errorContext,
                    phase: "body",
                }));

        return executeRequest(sendOptions, mapBodyError);
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
