import { describe, expect, test } from "bun:test";
import {
    createResponseGcController,
    ManualResponseCollectionBackend,
} from "../src/_internal/response-gc";

describe("response-gc.ts", () => {
    test("cleanup waits for the last tracked clone", () => {
        const backend = new ManualResponseCollectionBackend();
        let cleanupCalls = 0;

        const controller = createResponseGcController(
            () => {
                cleanupCalls += 1;
            },
            { backend },
        );

        const response = controller.track(new Response("hello"));
        const clone = response.clone();

        expect(backend.size).toBe(2);

        expect(backend.collect(response)).toBe(true);
        expect(cleanupCalls).toBe(0);
        expect(backend.size).toBe(1);

        expect(backend.collect(clone)).toBe(true);
        expect(cleanupCalls).toBe(1);
        expect(backend.size).toBe(0);
    });

    test("finalize unregisters tracked responses and ignores late collections", () => {
        const backend = new ManualResponseCollectionBackend();
        let cleanupCalls = 0;

        const controller = createResponseGcController(
            () => {
                cleanupCalls += 1;
            },
            { backend },
        );

        const response = controller.track(new Response("hello"));
        const clone = response.clone();

        expect(backend.size).toBe(2);

        controller.finalize();

        expect(backend.size).toBe(0);
        expect(backend.collect(response)).toBe(false);
        expect(backend.collect(clone)).toBe(false);
        expect(cleanupCalls).toBe(0);
    });

    test("tracking the same Response instance twice is idempotent", () => {
        const backend = new ManualResponseCollectionBackend();
        let cleanupCalls = 0;

        const controller = createResponseGcController(
            () => {
                cleanupCalls += 1;
            },
            { backend },
        );

        const response = new Response("hello");

        controller.track(response);
        controller.track(response);

        expect(backend.size).toBe(1);

        expect(backend.collect(response)).toBe(true);
        expect(cleanupCalls).toBe(1);
        expect(backend.size).toBe(0);
    });
});
