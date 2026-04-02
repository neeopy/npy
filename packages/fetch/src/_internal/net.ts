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
