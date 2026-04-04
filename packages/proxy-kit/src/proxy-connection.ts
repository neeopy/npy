import {
    type ConnectFunction,
    type HttpProxySettings,
    type ITcpConnection,
    type SocksProxySettings,
    type TcpEndpoint,
    withHttpProxy,
    withSocksProxy,
} from "@fuman/net";
import type { ProxyInfo, ProxyProtocol } from "./types";

export type ProxyProtocolLike = ProxyProtocol | "socks";

type SocksProxyProtocol = "socks" | "socks4" | "socks4a" | "socks5" | "socks5h";

type EndpointOptions<TOptions extends TcpEndpoint> = Omit<
    TOptions,
    keyof TcpEndpoint
>;

export type ProxyWithAliasProtocol = Omit<ProxyInfo, "protocol"> & {
    readonly protocol: ProxyProtocolLike;
};

export type ProxyConnectionFn<TOptions extends TcpEndpoint = TcpEndpoint> =
    ConnectFunction<TOptions, ITcpConnection>;

export interface CreateProxyConnectionProps<
    TOptions extends TcpEndpoint = TcpEndpoint,
> {
    readonly proxy: ProxyWithAliasProtocol;
    readonly connectionFn: ProxyConnectionFn<TOptions>;
}

const socksVersionMap = {
    socks: 5,
    socks4: 4,
    socks4a: 4,
    socks5: 5,
    socks5h: 5,
} satisfies Record<SocksProxyProtocol, 4 | 5>;

function isSocksProtocol(
    protocol: ProxyProtocolLike,
): protocol is SocksProxyProtocol {
    return (
        protocol === "socks" ||
        protocol === "socks4" ||
        protocol === "socks4a" ||
        protocol === "socks5" ||
        protocol === "socks5h"
    );
}

function extractEndpointOptions<TOptions extends TcpEndpoint>(
    endpoint: TOptions,
): EndpointOptions<TOptions> {
    const { address: _address, port: _port, ...options } = endpoint;
    return options as EndpointOptions<TOptions>;
}

function bindEndpointOptions<TOptions extends TcpEndpoint>(
    connectionFn: ProxyConnectionFn<TOptions>,
    endpoint: TOptions,
): ConnectFunction<TcpEndpoint, ITcpConnection> {
    const endpointOptions = extractEndpointOptions(endpoint);

    return (options) =>
        connectionFn({
            ...options,
            ...endpointOptions,
        } as TOptions);
}

function createHttpProxySettings(
    proxy: ProxyWithAliasProtocol,
): HttpProxySettings {
    return {
        host: proxy.host,
        port: proxy.port,
        user: proxy.user,
        password: proxy.password,
    };
}

function createSocksProxySettings(
    proxy: ProxyWithAliasProtocol,
    version: 4 | 5,
): SocksProxySettings {
    return {
        host: proxy.host,
        port: proxy.port,
        user: proxy.user,
        password: proxy.password,
        version,
    };
}

export function createProxyConnection<
    TOptions extends TcpEndpoint = TcpEndpoint,
>({
    proxy,
    connectionFn,
}: CreateProxyConnectionProps<TOptions>): ProxyConnectionFn<TOptions> {
    if (isSocksProtocol(proxy.protocol)) {
        const version = socksVersionMap[proxy.protocol];
        const socksProxy = createSocksProxySettings(proxy, version);

        return async (endpoint) => {
            const proxyConnect = withSocksProxy(
                bindEndpointOptions(connectionFn, endpoint),
                socksProxy,
            );

            return proxyConnect({
                address: endpoint.address,
                port: endpoint.port,
            });
        };
    }

    if (proxy.protocol === "http" || proxy.protocol === "https") {
        const httpProxy = createHttpProxySettings(proxy);

        return async (endpoint) => {
            const proxyConnect = withHttpProxy(
                bindEndpointOptions(connectionFn, endpoint),
                httpProxy,
            );

            return proxyConnect({
                address: endpoint.address,
                port: endpoint.port,
            });
        };
    }

    throw new Error(`Proxy type "${proxy.protocol}" not supported`);
}
