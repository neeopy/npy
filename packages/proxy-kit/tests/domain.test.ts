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
