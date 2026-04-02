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
