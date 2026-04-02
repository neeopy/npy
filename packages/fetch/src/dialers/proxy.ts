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
