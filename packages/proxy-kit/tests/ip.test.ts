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
