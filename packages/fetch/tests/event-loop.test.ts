import { describe, expect, test } from "bun:test";
import {
    getConnectionHandle,
    refConnection,
    unrefConnection,
    unrefTimer,
} from "../src/_internal/event-loop";

class FakeHandle {
    refCalls = 0;
    unrefCalls = 0;

    ref(): void {
        this.refCalls += 1;
    }

    unref(): void {
        this.unrefCalls += 1;
    }
}

describe("event-loop.ts", () => {
    test("connection helpers delegate to exposed socket handles only", () => {
        const handle = new FakeHandle();
        const conn = { socket: handle };

        expect(getConnectionHandle(conn as never)).toBe(handle);

        refConnection(conn as never);
        unrefConnection(conn as never);

        expect(handle.refCalls).toBe(1);
        expect(handle.unrefCalls).toBe(1);

        expect(getConnectionHandle({} as never)).toBeNull();
        expect(() => refConnection(undefined)).not.toThrow();
        expect(() => unrefConnection(undefined)).not.toThrow();
    });

    test("unrefTimer stays best-effort and non-throwing", () => {
        const handle = new FakeHandle();

        expect(() => unrefTimer(undefined)).not.toThrow();
        expect(() => unrefTimer({} as never)).not.toThrow();
        expect(() => unrefTimer(handle as never)).not.toThrow();

        expect(handle.unrefCalls).toBe(1);
    });
});
