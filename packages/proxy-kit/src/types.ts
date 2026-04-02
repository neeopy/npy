import type { SetRequired } from "type-fest";

export type StrictOptions = Partial<{
    strict: boolean;
}>;

export const proxyProtocols = [
    "http",
    "https",
    "socks4",
    "socks4a",
    "socks5",
    "socks5h",
] as const;
export type ProxyProtocol = (typeof proxyProtocols)[number];

export type AnyProxyInfo<T extends ProxyProtocol = ProxyProtocol> = {
    readonly protocol?: T;
    readonly host: string;
    readonly port: number;
    readonly user?: string;
    readonly password?: string;
};

export type ProxyInfo<T extends ProxyProtocol = ProxyProtocol> = SetRequired<
    AnyProxyInfo<T>,
    "protocol"
>;

export type HttpProxy = ProxyInfo<"http">;
export type HttpsProxy = ProxyInfo<"https">;
export type HttpLikeProxy = HttpProxy | HttpsProxy;
export type Socks4Proxy = ProxyInfo<"socks4" | "socks4a">;
export type Socks5Proxy = ProxyInfo<"socks5" | "socks5h">;
export type SocksProxy = Socks4Proxy | Socks5Proxy;
export type SupportedProxy = HttpLikeProxy | SocksProxy;

export interface ParseOptions extends StrictOptions {
    defaultProtocol?: ProxyProtocol;
}

export const proxyUriFormats = [
    "ip:port",
    "ip:port:user:pass",
    "user:pass:ip:port",
    "ip:port@user:pass",
    "user:pass@ip:port",
] as const;
export type ProxyUriFormat = (typeof proxyUriFormats)[number];

export interface StringifyOptions extends StrictOptions {
    format?: ProxyUriFormat;
}
