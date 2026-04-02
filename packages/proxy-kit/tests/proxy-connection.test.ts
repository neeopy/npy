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
