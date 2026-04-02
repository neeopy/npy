# Parsed codebase for the project: proxy-kit


## Directory Structure
- proxy-kit/
- proxy-kit/src/
- proxy-kit/src/proxy-connection.ts (3693 bytes)
- proxy-kit/src/types.ts (1408 bytes)
- proxy-kit/src/domain.ts (1351 bytes)
- proxy-kit/src/index.ts (87 bytes)
- proxy-kit/src/parser.ts (6167 bytes)
- proxy-kit/src/ip.ts (1775 bytes)
- proxy-kit/tests/
- proxy-kit/tests/ip.test.ts (1161 bytes)
- proxy-kit/tests/parser.test.ts (7212 bytes)
- proxy-kit/tests/proxy-connection.test.ts (1907 bytes)
- proxy-kit/tests/domain.test.ts (1237 bytes)
- proxy-kit/README.md (0 bytes)
- proxy-kit/package.json (338 bytes)
- proxy-kit/tsconfig.json (848 bytes)
- proxy-kit/bun.lock (4612 bytes)

## Summary
- Total files: 14
- Total directories: 2
- Total text file size (including ignored): 669.38 KB
- Total tokens: 9539
- Analyzed text content size: 31.05 KB

Top largest non-ignored files:
- proxy-kit/tests/parser.test.ts (7.04 kB)
- proxy-kit/src/parser.ts (6.02 kB)
- proxy-kit/bun.lock (4.50 kB)
- proxy-kit/src/proxy-connection.ts (3.61 kB)
- proxy-kit/tests/proxy-connection.test.ts (1.86 kB)
- proxy-kit/src/ip.ts (1.73 kB)
- proxy-kit/src/types.ts (1.38 kB)
- proxy-kit/src/domain.ts (1.32 kB)
- proxy-kit/tests/domain.test.ts (1.21 kB)
- proxy-kit/tests/ip.test.ts (1.13 kB)

Top largest non-ignored directories:
- proxy-kit/src (14.14 kB)
- proxy-kit/tests (11.25 kB)


## Ignore summary:
During the analysis, some files were ignored:
- No of files ignored during parsing: 302
- Patterns used to ignore files: {'*.log', 'dist', '__pycache__', '*.swp', '*.egg-info', '*.dll', '*.tmp', '*.pyd', 'env', '*.so', '.git', 'node_modules', '.vscode', '.idea', '.venv', '*.pyc', '.svn', 'build', '*.bak', '.DS_Store', '.hg', 'venv', '.gitignore', 'Thumbs.db', '*.pyo', '*.dylib', 'bower_components'}

## Files:
### proxy-kit/src/proxy-connection.ts

```
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

type ProxyProtocolLike = ProxyProtocol | "socks";

type SocksProxyProtocol = "socks" | "socks4" | "socks4a" | "socks5" | "socks5h";

type EndpointOptions<TOptions extends TcpEndpoint> = Omit<
    TOptions,
    keyof TcpEndpoint
>;

type ProxyWithAliasProtocol = Omit<ProxyInfo, "protocol"> & {
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

```

### proxy-kit/src/types.ts

```
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

```

### proxy-kit/src/domain.ts

```
import tlds from "tlds";
import type { StrictOptions } from "./types";

const alphabets = "a-z";
const numbers = "0-9";
const labelLetters = `${alphabets}${numbers}\\u00a1-\\uffff`;
const relaxedLabelLetters = `${labelLetters}_`;
const relaxedLabelLettersWithHyphen = `${relaxedLabelLetters}-`;
const idnPrefix = "xn--";

const nonDigitTwoOrMoreLabelWithHyphen = `[${alphabets}\\-]{2,63}`;

const nonStrictTld = nonDigitTwoOrMoreLabelWithHyphen;
const strictTld = `${tlds.sort((a, b) => b.length - a.length).join("|")}`;

const finalLabelStrict = `[${labelLetters}](?:[${labelLetters}\\-]{0,61}[${labelLetters}])?`;
const finalLabelRelaxed = `[${relaxedLabelLetters}](?:[${relaxedLabelLettersWithHyphen}]{0,61}[${relaxedLabelLetters}])?`;
const finalLabelIDN = `${idnPrefix}[${labelLetters}]{0,59}`;

const notFakePuny = `(?![^x][^n]--)`;

export function domainRegex(options: StrictOptions = { strict: true }): RegExp {
    const tld = options.strict ? strictTld : nonStrictTld;

    const lookahead = `(?=[${relaxedLabelLetters}\\-.]{1,252}\\.(${tld})\\b)`;

    const subdomain = `(?:${notFakePuny}(?:${finalLabelIDN}|${finalLabelRelaxed})\\.){0,126}`;

    const finalLabel = `${notFakePuny}(?:${finalLabelIDN}|${finalLabelStrict})\\.`;

    const regex = `${lookahead}${subdomain}${finalLabel}(${tld})\\b`;

    return new RegExp(regex, "gi");
}

```

### proxy-kit/src/index.ts

```
export * from "./parser";
export * from "./proxy-connection";
export * from "./types";

```

### proxy-kit/src/parser.ts

```
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

type ParseReturn<Opts extends ParseOptions | undefined> = Opts extends {
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

```

### proxy-kit/src/ip.ts

```
export interface Options {
    includeBoundaries?: boolean;
    exact?: boolean;
}

const word = "[a-fA-F\\d:]";

const boundry = (options?: Options) =>
    options?.includeBoundaries
        ? `(?:(?<=\\s|^)(?=${word})|(?<=${word})(?=\\s|$))`
        : "";
const v4 =
    "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)){3}";
const v6segment = "[a-fA-F\\d]{1,4}";
const v6 = `
(?:
(?:${v6segment}:){7}(?:${v6segment}|:)|
(?:${v6segment}:){6}(?:${v4}|:${v6segment}|:)|
(?:${v6segment}:){5}(?::${v4}|(?::${v6segment}){1,2}|:)|
(?:${v6segment}:){4}(?:(?::${v6segment}){0,1}:${v4}|(?::${v6segment}){1,3}|:)|
(?:${v6segment}:){3}(?:(?::${v6segment}){0,2}:${v4}|(?::${v6segment}){1,4}|:)|
(?:${v6segment}:){2}(?:(?::${v6segment}){0,3}:${v4}|(?::${v6segment}){1,5}|:)|
(?:${v6segment}:){1}(?:(?::${v6segment}){0,4}:${v4}|(?::${v6segment}){1,6}|:)|
(?::(?:(?::${v6segment}){0,5}:${v4}|(?::${v6segment}){1,7}|:))
)(?:%[0-9a-zA-Z]{1,})?
`
    .replace(/\s*\/\/.*$/gm, "")
    .replace(/\n/g, "")
    .trim();

const v46Exact = new RegExp(`(?:^${v4}$)|(?:^${v6}$)`);
const v4exact = new RegExp(`^${v4}$`);
const v6exact = new RegExp(`^${v6}$`);

export const ipRegex = (options?: Options): RegExp =>
    options?.exact
        ? v46Exact
        : new RegExp(
              `(?:${boundry(options)}${v4}${boundry(options)})|(?:${boundry(options)}${v6}${boundry(options)})`,
              "g",
          );

ipRegex.v4 = (options?: Options): RegExp =>
    options?.exact
        ? v4exact
        : new RegExp(`${boundry(options)}${v4}${boundry(options)}`, "g");
ipRegex.v6 = (options?: Options): RegExp =>
    options?.exact
        ? v6exact
        : new RegExp(`${boundry(options)}${v6}${boundry(options)}`, "g");

export default ipRegex;

```

### proxy-kit/tests/ip.test.ts

```
import { describe, expect, test } from "bun:test";
import ipRegex from "../src/ip";

describe("ipRegex", () => {
    test("v4 exact ok/ko", () => {
        expect(ipRegex.v4({ exact: true }).test("192.168.0.1")).toBe(true);
        expect(ipRegex.v4({ exact: true }).test("256.0.0.1")).toBe(false);
    });

    test("v6 exact ok/ko", () => {
        expect(ipRegex.v6({ exact: true }).test("2001:db8::1")).toBe(true);
        expect(ipRegex.v6({ exact: true }).test("12345::")).toBe(false);
    });

    test("mixed (não exact) encontra múltiplos no texto", () => {
        const re = ipRegex();
        const str = "ping 127.0.0.1 then 2001:db8::1 done";
        const matches = str.match(re);
        expect(matches?.length).toBe(2);
        expect(matches?.[0]).toBe("127.0.0.1");
        expect(matches?.[1]).toBe("2001:db8::1");
    });

    test("includeBoundaries evita capturar pedaços", () => {
        const str = "xx127.0.0.1yy";
        const noBound = str.match(ipRegex());
        const withBound = str.match(ipRegex({ includeBoundaries: true }));
        expect(noBound?.[0]).toBe("127.0.0.1");
        expect(withBound).toBeNull();
    });
});

```

### proxy-kit/tests/parser.test.ts

```
import { describe, expect, test } from "bun:test";
import {
    isHttp,
    isHttps,
    isPort,
    isSocks,
    isSocks4,
    isSocks5,
    isTyped,
    parse,
    stringify,
    stringifyFormat,
} from "../src/parser";
import type { AnyProxyInfo } from "../src/types";

describe("parser.parse", () => {
    test("http with credentials (strict)", () => {
        const p = parse("http://user:pass@proxy.example.com:8080", {
            strict: true,
        });
        expect(p).not.toBeNull();
        expect(p!.protocol).toBe("http");
        expect(p!.host).toBe("proxy.example.com");
        expect(p!.port).toBe(8080);
        expect(p!.user).toBe("user");
        expect(p!.password).toBe("pass");
    });

    test("standard URI without credentials", () => {
        const p = parse("http://127.0.0.1:46253", {
            strict: true,
        });
        expect(p).not.toBeNull();
        expect(p!.protocol).toBe("http");
        expect(p!.host).toBe("127.0.0.1");
        expect(p!.port).toBe(46253);
        expect(p!.user).toBeUndefined();
        expect(p!.password).toBeUndefined();
    });

    test("standard URI without credentials (IPv6)", () => {
        const p = parse("http://[2001:db8::1]:8080", {
            strict: true,
        });
        expect(p).not.toBeNull();
        expect(p!.protocol).toBe("http");
        expect(p!.host).toBe("2001:db8::1");
        expect(p!.port).toBe(8080);
    });

    test("host:port without credentials works in non-strict mode", () => {
        const p = parse("127.0.0.1:8080");
        expect(p).not.toBeNull();
        expect(p!.protocol).toBeUndefined();
        expect(p!.host).toBe("127.0.0.1");
        expect(p!.port).toBe(8080);
        expect(p!.user).toBeUndefined();
        expect(p!.password).toBeUndefined();
    });

    test("host:port without credentials works with defaultProtocol in strict mode", () => {
        const p = parse("127.0.0.1:8080", {
            strict: true,
            defaultProtocol: "http",
        });
        expect(p).not.toBeNull();
        expect(p!.protocol).toBe("http");
        expect(p!.host).toBe("127.0.0.1");
        expect(p!.port).toBe(8080);
    });

    test("variants: host:port@user:pass e user:pass:host:port", () => {
        const a = parse("proxy.example.com:3128@u:p", {
            strict: true,
            defaultProtocol: "https",
        });
        expect(a).not.toBeNull();
        expect(a!.protocol).toBe("https");

        const b = parse("u:p:proxy.example.com:3128", {
            strict: true,
            defaultProtocol: "http",
        });
        expect(b).not.toBeNull();
        expect(b!.protocol).toBe("http");
    });

    test("IPv6 com colchetes", () => {
        const p = parse("http://u:p@[2001:db8::1]:8080", { strict: true });
        expect(p).not.toBeNull();
        expect(p!.host).toBe("2001:db8::1");
        expect(p!.port).toBe(8080);
    });

    test("socks normaliza 'socks' -> socks5", () => {
        const p = parse("socks://u:p@host.dev:1080", { strict: true });
        expect(p).not.toBeNull();
        expect(p!.protocol).toBe("socks5");
    });

    test("strict exige protocolo e porta válida", () => {
        expect(parse("host.dev:99999@u:p", { strict: true })).toBeNull();
        expect(parse("host.dev:8080@u:p", { strict: true })).toBeNull();
        expect(parse("127.0.0.1:8080", { strict: true })).toBeNull();
    });

    test("non-strict aceita sem protocolo e formatações soltas", () => {
        const p = parse("user:pass@host.dev:8080");
        expect(p).not.toBeNull();
        expect(p!.protocol).toBeUndefined();
        expect(p!.host).toBe("host.dev");
        expect(p!.port).toBe(8080);
    });

    test("defaultProtocol é aplicado quando faltar", () => {
        const p = parse("user:pass@host.dev:8080", {
            strict: true,
            defaultProtocol: "socks5",
        });
        expect(p).not.toBeNull();
        expect(p!.protocol).toBe("socks5");
    });
});

describe("parser.stringify & stringifyFormat", () => {
    test("formato user:pass@ip:port (com IPv6 entre colchetes)", () => {
        const info: AnyProxyInfo = {
            protocol: "http",
            host: "2001:db8::1",
            port: 3128,
            user: "u",
            password: "p",
        };
        const s = stringify(info, {
            format: "user:pass@ip:port",
            strict: true,
        });
        expect(s).toBe("http://u:p@[2001:db8::1]:3128");
    });

    test("formato URI padrão sem credenciais", () => {
        const info: AnyProxyInfo = {
            protocol: "http",
            host: "proxy.example.com",
            port: 8080,
            user: "u",
            password: "p",
        };

        const s = stringify(info, {
            format: "ip:port",
            strict: true,
        });

        expect(s).toBe("http://proxy.example.com:8080");
    });

    test("formato URI padrão sem credenciais (IPv6)", () => {
        const info: AnyProxyInfo = {
            protocol: "https",
            host: "2001:db8::1",
            port: 8443,
        };

        const s = stringify(info, {
            format: "ip:port",
            strict: true,
        });

        expect(s).toBe("https://[2001:db8::1]:8443");
    });

    test("outros formatos", () => {
        const info: AnyProxyInfo = {
            protocol: "https",
            host: "proxy.example.com",
            port: 443,
            user: "u",
            password: "p",
        };
        expect(stringifyFormat(info, "ip:port")).toBe(
            "https://proxy.example.com:443",
        );
        expect(stringifyFormat(info, "ip:port:user:pass")).toBe(
            "https://proxy.example.com:443:u:p",
        );
        expect(stringifyFormat(info, "user:pass:ip:port")).toBe(
            "https://u:p:proxy.example.com:443",
        );
        expect(stringifyFormat(info, "ip:port@user:pass")).toBe(
            "https://proxy.example.com:443@u:p",
        );
        expect(stringifyFormat(info, "user:pass@ip:port")).toBe(
            "https://u:p@proxy.example.com:443",
        );
    });

    test("strict: stringify retorna null se protocolo faltar/for inválido", () => {
        const infoNoProto: AnyProxyInfo = {
            host: "h.dev",
            port: 1,
            user: "u",
            password: "p",
        };
        expect(stringify(infoNoProto, { strict: true })).toBeNull();
    });
});

describe("parser helpers", () => {
    test("isPort", () => {
        expect(isPort(80)).toBe(true);
        expect(isPort("443")).toBe(true);
        expect(isPort(0)).toBe(false);
        expect(isPort(65536)).toBe(false);
    });

    test("type guards", () => {
        const a = parse("http://u:p@h.dev:1", { strict: true })!;
        const b = parse("https://u:p@h.dev:1", { strict: true })!;
        const c = parse("socks4://u:p@h.dev:1", { strict: true })!;
        const d = parse("socks5://u:p@h.dev:1", { strict: true })!;

        expect(isTyped(a)).toBe(true);
        expect(isHttp(a)).toBe(true);
        expect(isHttps(b)).toBe(true);
        expect(isSocks(c)).toBe(true);
        expect(isSocks4(c)).toBe(true);
        expect(isSocks5(d)).toBe(true);
    });
});

```

### proxy-kit/tests/proxy-connection.test.ts

```
import { describe, expect, test } from "bun:test";
import type { TcpEndpoint } from "@fuman/net";
import {
    createProxyConnection,
    type ProxyConnectionFn,
} from "../src/proxy-connection";
import type { ProxyInfo, ProxyProtocol } from "../src/types";

type ProxyProtocolLike = ProxyProtocol | "socks";

describe("proxy-connection", () => {
    const connectionFn = ((_) => {
        throw new Error("connectionFn should not be called in this test");
    }) as ProxyConnectionFn<TcpEndpoint>;

    function make(
        settings: Partial<ProxyInfo> & { type: ProxyProtocolLike | string },
    ) {
        return createProxyConnection({
            proxy: {
                protocol: settings.type as ProxyProtocolLike,
                host: settings.host ?? "127.0.0.1",
                port: settings.port ?? 3128,
                user: settings.user,
                password: settings.password,
            },
            connectionFn,
        });
    }

    test("returns a function for http/https proxies", () => {
        const fnHttp = make({ type: "http" });
        const fnHttps = make({ type: "https" });

        expect(typeof fnHttp).toBe("function");
        expect(typeof fnHttps).toBe("function");
    });

    test("returns a function for socks flavors (socks, socks4, socks4a, socks5)", () => {
        expect(typeof make({ type: "socks" })).toBe("function");
        expect(typeof make({ type: "socks4" })).toBe("function");
        expect(typeof make({ type: "socks4a" })).toBe("function");
        expect(typeof make({ type: "socks5" })).toBe("function");
    });

    test("passes through credentials (no throw)", () => {
        const fn = make({ type: "http", user: "u", password: "p" });

        expect(typeof fn).toBe("function");
    });

    test("unsupported proxy type throws", () => {
        expect(() => make({ type: "ssh" })).toThrow(/not supported/i);
    });
});

```

### proxy-kit/tests/domain.test.ts

```
import { describe, expect, test } from "bun:test";
import { domainRegex } from "../src/domain";

describe("domainRegex", () => {
    test("strict = true matches known TLDs and rejects bogus TLDs", () => {
        const re = domainRegex({ strict: true });
        expect("example.com".match(re)).toBeTruthy();
        expect("sub.example.co.uk".match(re)).toBeTruthy();
        expect("a.invalidtldd".match(re)).toBeNull();
    });

    test("supports IDN punycode in strict mode", () => {
        const re = domainRegex({ strict: true });
        expect("xn--bcher-kva.de".match(re)).toBeTruthy();
    });

    test("non-strict allows generic alphabetic TLDs >= 2 chars", () => {
        const re = domainRegex({ strict: false });
        expect("foo.dev".match(re)).toBeTruthy();
        expect("bar.corp".match(re)).toBeTruthy();
        expect("a.b".match(re)).toBeNull();
    });

    test("does not match labels longer que 63 chars", () => {
        const long = "a".repeat(64);
        const base = domainRegex({ strict: false });
        const anchored = new RegExp(`^${base.source}$`, "i");

        expect(anchored.test(`${long}.com`)).toBe(false);
        expect(anchored.test(`${"a".repeat(63)}.com`)).toBe(true);
    });
});

```

### proxy-kit/README.md

```

```

### proxy-kit/package.json

```
{
    "name": "@npy/proxy-kit",
    "module": "src/index.ts",
    "type": "module",
    "license": "MIT",
    "sideEffects": false,
    "exports": {
        ".": "./src/index.ts"
    },
    "devDependencies": {
        "type-fest": "^5.5.0"
    },
    "dependencies": {
        "@fuman/net": "^0.0.19",
        "tlds": "^1.261.0"
    }
}

```

### proxy-kit/tsconfig.json

```
{
    "compilerOptions": {
        // Environment setup & latest features
        "lib": ["ESNext", "DOM", "DOM.Iterable", "DOM.AsyncIterable"],
        "target": "ESNext",
        "module": "esnext",
        "moduleDetection": "force",
        "jsx": "react-jsx",
        "allowJs": true,

        // Bundler mode
        "moduleResolution": "bundler",
        "allowImportingTsExtensions": true,
        "verbatimModuleSyntax": true,
        "noEmit": true,

        // Best practices
        "strict": false,
        "skipLibCheck": true,
        "noFallthroughCasesInSwitch": true,
        "noUncheckedIndexedAccess": true,
        "noImplicitOverride": true,

        // Some stricter flags (disabled by default)
        "noUnusedLocals": false,
        "noUnusedParameters": false,
        "noPropertyAccessFromIndexSignature": false
    }
}

```

### proxy-kit/bun.lock

```
{
  "lockfileVersion": 1,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "@npy/fetch",
      "dependencies": {
        "@fuman/net": "^0.0.19",
        "tlds": "^1.261.0",
      },
      "devDependencies": {
        "@biomejs/biome": "2.4.9",
        "@types/bun": "latest",
        "type-fest": "^5.5.0",
      },
      "peerDependencies": {
        "typescript": "^5",
      },
    },
  },
  "packages": {
    "@biomejs/biome": ["@biomejs/biome@2.4.9", "", { "optionalDependencies": { "@biomejs/cli-darwin-arm64": "2.4.9", "@biomejs/cli-darwin-x64": "2.4.9", "@biomejs/cli-linux-arm64": "2.4.9", "@biomejs/cli-linux-arm64-musl": "2.4.9", "@biomejs/cli-linux-x64": "2.4.9", "@biomejs/cli-linux-x64-musl": "2.4.9", "@biomejs/cli-win32-arm64": "2.4.9", "@biomejs/cli-win32-x64": "2.4.9" }, "bin": { "biome": "bin/biome" } }, "sha512-wvZW92FrwitTcacvCBT8xdAbfbxWfDLwjYMmU3djjqQTh7Ni4ZdiWIT/x5VcZ+RQuxiKzIOzi5D+dcyJDFZMsA=="],

    "@biomejs/cli-darwin-arm64": ["@biomejs/cli-darwin-arm64@2.4.9", "", { "os": "darwin", "cpu": "arm64" }, "sha512-d5G8Gf2RpH5pYwiHLPA+UpG3G9TLQu4WM+VK6sfL7K68AmhcEQ9r+nkj/DvR/GYhYox6twsHUtmWWWIKfcfQQA=="],

    "@biomejs/cli-darwin-x64": ["@biomejs/cli-darwin-x64@2.4.9", "", { "os": "darwin", "cpu": "x64" }, "sha512-LNCLNgqDMG7BLdc3a8aY/dwKPK7+R8/JXJoXjCvZh2gx8KseqBdFDKbhrr7HCWF8SzNhbTaALhTBoh/I6rf9lA=="],

    "@biomejs/cli-linux-arm64": ["@biomejs/cli-linux-arm64@2.4.9", "", { "os": "linux", "cpu": "arm64" }, "sha512-4adnkAUi6K4C/emPRgYznMOcLlUqZdXWM6aIui4VP4LraE764g6Q4YguygnAUoxKjKIXIWPteKMgRbN0wsgwcg=="],

    "@biomejs/cli-linux-arm64-musl": ["@biomejs/cli-linux-arm64-musl@2.4.9", "", { "os": "linux", "cpu": "arm64" }, "sha512-8RCww5xnPn2wpK4L/QDGDOW0dq80uVWfppPxHIUg6mOs9B6gRmqPp32h1Ls3T8GnW8Wo5A8u7vpTwz4fExN+sw=="],

    "@biomejs/cli-linux-x64": ["@biomejs/cli-linux-x64@2.4.9", "", { "os": "linux", "cpu": "x64" }, "sha512-L10na7POF0Ks/cgLFNF1ZvIe+X4onLkTi5oP9hY+Rh60Q+7fWzKDDCeGyiHUFf1nGIa9dQOOUPGe2MyYg8nMSQ=="],

    "@biomejs/cli-linux-x64-musl": ["@biomejs/cli-linux-x64-musl@2.4.9", "", { "os": "linux", "cpu": "x64" }, "sha512-5TD+WS9v5vzXKzjetF0hgoaNFHMcpQeBUwKKVi3JbG1e9UCrFuUK3Gt185fyTzvRdwYkJJEMqglRPjmesmVv4A=="],

    "@biomejs/cli-win32-arm64": ["@biomejs/cli-win32-arm64@2.4.9", "", { "os": "win32", "cpu": "arm64" }, "sha512-aDZr0RBC3sMGJOU10BvG7eZIlWLK/i51HRIfScE2lVhfts2dQTreowLiJJd+UYg/tHKxS470IbzpuKmd0MiD6g=="],

    "@biomejs/cli-win32-x64": ["@biomejs/cli-win32-x64@2.4.9", "", { "os": "win32", "cpu": "x64" }, "sha512-NS4g/2G9SoQ4ktKtz31pvyc/rmgzlcIDCGU/zWbmHJAqx6gcRj2gj5Q/guXhoWTzCUaQZDIqiCQXHS7BcGYc0w=="],

    "@fuman/io": ["@fuman/io@0.0.19", "", { "dependencies": { "@fuman/utils": "^0.0.19" } }, "sha512-B+2n3GVa9PCYMJ9xfsdXUlUV9yXO4gKLYfxm815PeJ+MGOw5TbEp166drRmBq1AtxVnP0efy6Oz9rYpKVODgow=="],

    "@fuman/net": ["@fuman/net@0.0.19", "", { "dependencies": { "@fuman/io": "^0.0.19", "@fuman/utils": "^0.0.19" } }, "sha512-yISM+JcZEWBpBYn0v2mUY/Zst4SsicTRaVTvRkVhMiZhgMzdXalfvRwRV/vsgwwL31bntwowCTDW4iilCJLbXg=="],

    "@fuman/utils": ["@fuman/utils@0.0.19", "", {}, "sha512-4qVrZ9AjKYztLJsNr1Tp7kL48b22dvVLN1iVW+Me8ZSQ0ILN0qknoxjsczVPReF7+GDWgknNxR2l6ggrA4SZyw=="],

    "@types/bun": ["@types/bun@1.3.11", "", { "dependencies": { "bun-types": "1.3.11" } }, "sha512-5vPne5QvtpjGpsGYXiFyycfpDF2ECyPcTSsFBMa0fraoxiQyMJ3SmuQIGhzPg2WJuWxVBoxWJ2kClYTcw/4fAg=="],

    "@types/node": ["@types/node@25.5.0", "", { "dependencies": { "undici-types": "~7.18.0" } }, "sha512-jp2P3tQMSxWugkCUKLRPVUpGaL5MVFwF8RDuSRztfwgN1wmqJeMSbKlnEtQqU8UrhTmzEmZdu2I6v2dpp7XIxw=="],

    "bun-types": ["bun-types@1.3.11", "", { "dependencies": { "@types/node": "*" } }, "sha512-1KGPpoxQWl9f6wcZh57LvrPIInQMn2TQ7jsgxqpRzg+l0QPOFvJVH7HmvHo/AiPgwXy+/Thf6Ov3EdVn1vOabg=="],

    "tagged-tag": ["tagged-tag@1.0.0", "", {}, "sha512-yEFYrVhod+hdNyx7g5Bnkkb0G6si8HJurOoOEgC8B/O0uXLHlaey/65KRv6cuWBNhBgHKAROVpc7QyYqE5gFng=="],

    "tlds": ["tlds@1.261.0", "", { "bin": { "tlds": "bin.js" } }, "sha512-QXqwfEl9ddlGBaRFXIvNKK6OhipSiLXuRuLJX5DErz0o0Q0rYxulWLdFryTkV5PkdZct5iMInwYEGe/eR++1AA=="],

    "type-fest": ["type-fest@5.5.0", "", { "dependencies": { "tagged-tag": "^1.0.0" } }, "sha512-PlBfpQwiUvGViBNX84Yxwjsdhd1TUlXr6zjX7eoirtCPIr08NAmxwa+fcYBTeRQxHo9YC9wwF3m9i700sHma8g=="],

    "typescript": ["typescript@5.9.3", "", { "bin": { "tsc": "bin/tsc", "tsserver": "bin/tsserver" } }, "sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw=="],

    "undici-types": ["undici-types@7.18.2", "", {}, "sha512-AsuCzffGHJybSaRrmr5eHr81mwJU3kjw6M+uprWvCXiNeN9SOGwQ3Jn8jb8m3Z6izVgknn1R0FTCEAP2QrLY/w=="],
  }
}

```

