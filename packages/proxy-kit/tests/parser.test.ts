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
