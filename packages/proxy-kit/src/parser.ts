import { domainRegex } from "./domain";
import { ipRegex } from "./ip";
import {
    type AnyProxyInfo,
    type HttpLikeProxy,
    type HttpProxy,
    type HttpsProxy,
    type ParseOptions,
    type ProxyInfo,
    type ProxyProtocol,
    type ProxyUriFormat,
    proxyProtocols,
    type Socks4Proxy,
    type Socks5Proxy,
    type SocksProxy,
    type StringifyOptions,
} from "./types";

const proxyProtocolPattern =
    "(?<protocol>https?|socks4a|socks(?:[45]h?)?):\\/\\/";
const proxyPrefixPattern = `^(?:${proxyProtocolPattern})?`;
const portPattern = "\\d{1,5}";
const userPassPattern = "[\\w.~%+-]+";
const ipPattern = ipRegex().source;
const domainPattern = domainRegex({ strict: false }).source;
const v6Only = ipRegex.v6().source;
const hostPattern = `(?:\\[(?<ipv6>${v6Only})\\]|${ipPattern}|${domainPattern})`;

const proxyPatterns = [
    // user:pass@host:port
    `${proxyPrefixPattern}(?<user>${userPassPattern})(?::(?<pass>${userPassPattern}))?@(?<host>${hostPattern}):(?<port>${portPattern})$`,
    // host:port@user:pass
    `${proxyPrefixPattern}(?<host>${hostPattern}):(?<port>${portPattern})@(?<user>${userPassPattern})(?::(?<pass>${userPassPattern}))?$`,
    // user:pass:host:port
    `${proxyPrefixPattern}(?<user>${userPassPattern}):(?<pass>${userPassPattern}):(?<host>${hostPattern}):(?<port>${portPattern})$`,
    // host:port:user:pass
    `${proxyPrefixPattern}(?<host>${hostPattern}):(?<port>${portPattern}):(?<user>${userPassPattern}):(?<pass>${userPassPattern})$`,
    // standard URI / plain host:port without credentials
    `${proxyPrefixPattern}(?<host>${hostPattern}):(?<port>${portPattern})$`,
];

const proxyRegexes = proxyPatterns.map((pat) => new RegExp(pat, "i"));

export type ParseReturn<Opts extends ParseOptions | undefined> = Opts extends {
    strict: true;
}
    ? ProxyInfo | null
    : AnyProxyInfo | null;

export function parse<Opts extends ParseOptions | undefined>(
    uri: string,
    options?: Opts,
): ParseReturn<Opts> {
    for (const regex of proxyRegexes) {
        const match = regex.exec(uri.trim());
        if (match?.groups) {
            let host = match.groups.host;
            if (host?.startsWith("[") && host.endsWith("]")) {
                host = host.slice(1, -1);
            }

            const portNum =
                match.groups.port !== undefined
                    ? Number(match.groups.port)
                    : undefined;

            if (options?.strict) {
                if (portNum === undefined || !isPort(portNum)) {
                    return null as ParseReturn<Opts>;
                }
            }

            const port =
                portNum !== undefined && isPort(portNum) ? portNum : undefined;

            const protoRaw = (match.groups.protocol ||
                options?.defaultProtocol) as string | undefined;

            let protocolStr = protoRaw ? protoRaw.toLowerCase() : undefined;

            if (protocolStr === "socks") {
                protocolStr = "socks5";
            }

            const protocol = protocolStr as ProxyProtocol | undefined;

            if (options?.strict) {
                if (!protocol || !proxyProtocols.includes(protocol)) {
                    return null as ParseReturn<Opts>;
                }
            }

            const result = {
                protocol,
                host,
                port,
                user: match.groups.user,
                password: match.groups.pass,
            };

            return result as ParseReturn<Opts>;
        }
    }

    return null as ParseReturn<Opts>;
}

export const stringifyFormat = (
    proxy: AnyProxyInfo,
    format: ProxyUriFormat = "ip:port:user:pass",
): string | null => {
    const proto = proxy.protocol ? `${proxy.protocol}://` : "";
    const hostPort = `${proxy.host}:${proxy.port}`;
    const credentials = proxy.user
        ? proxy.password
            ? `${proxy.user}:${proxy.password}`
            : proxy.user
        : "";

    switch (format.toLowerCase()) {
        case "ip:port":
            return `${proto}${hostPort}`;
        case "ip:port:user:pass":
            return `${proto}${[proxy.host, proxy.port, credentials].filter(Boolean).join(":")}`;
        case "user:pass:ip:port":
            return `${proto}${[credentials, proxy.host, proxy.port].filter(Boolean).join(":")}`;
        case "ip:port@user:pass":
            return `${proto}${[hostPort, credentials].filter(Boolean).join("@")}`;
        case "user:pass@ip:port":
            return `${proto}${[credentials, hostPort].filter(Boolean).join("@")}`;
        default:
            return null;
    }
};

export function stringify(
    proxy: AnyProxyInfo,
    options?: StringifyOptions,
): string | null {
    if (options?.strict) {
        if (!proxy.protocol || !proxyProtocols.includes(proxy.protocol)) {
            return null;
        }
    }

    const format: ProxyUriFormat = options?.format || "user:pass@ip:port";
    let host = proxy.host;
    if (host?.includes(":") && !host?.includes(".")) {
        host = `[${host}]`;
    }
    const proxyWithFixedHost = { ...proxy, host };
    return stringifyFormat(proxyWithFixedHost, format);
}

export function isPort(value: string | number): boolean {
    const num = Number(value);
    return Number.isSafeInteger(num) && num > 0 && num < 65536;
}

export function isHttp(proxy: AnyProxyInfo): proxy is HttpProxy {
    return proxy.protocol === "http";
}

export function isHttps(proxy: AnyProxyInfo): proxy is HttpsProxy {
    return proxy.protocol === "https";
}

export function isHttpLike(proxy: AnyProxyInfo): proxy is HttpLikeProxy {
    return isHttp(proxy) || isHttps(proxy);
}

export function isSocks4(proxy: AnyProxyInfo): proxy is Socks4Proxy {
    return proxy.protocol === "socks4" || proxy.protocol === "socks4a";
}

export function isSocks5(proxy: AnyProxyInfo): proxy is Socks5Proxy {
    return proxy.protocol === "socks5" || proxy.protocol === "socks5h";
}

export function isSocks(proxy: AnyProxyInfo): proxy is SocksProxy {
    return isSocks4(proxy) || isSocks5(proxy);
}

export function isTyped(proxy: AnyProxyInfo): proxy is ProxyInfo {
    return !!proxy.protocol;
}
