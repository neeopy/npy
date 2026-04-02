import { describe, expect, test } from "bun:test";
import {
    AgentBusyError,
    ConnectionError,
    ConnectTimeoutError,
    ErrorType,
    FetchError,
    FetchErrorCode,
    HttpStatusError,
    OriginMismatchError,
    RequestAbortedError,
    ResponseBodyError,
    ResponseHeaderError,
    UnsupportedMethodError,
} from "../src/errors.ts";

describe("errors.ts", () => {
    test("base FetchError exposes code, phase, retryable and cause", () => {
        const cause = new Error("boom");
        const error = new ResponseHeaderError(cause, {
            url: "http://example.test/resource",
            method: "GET",
            origin: "http://example.test",
        });

        expect(error).toBeInstanceOf(FetchError);
        expect(error.name).toBe("ResponseHeaderError");
        expect(error.code).toBe(FetchErrorCode.RESPONSE_HEADERS);
        expect(error.phase).toBe("response");
        expect(error.retryable).toBe(true);
        expect(error.type).toBe(ErrorType.NETWORK);
        expect(error.cause).toBe(cause);
        expect(error.context?.url).toBe("http://example.test/resource");
        expect(error.context?.method).toBe("GET");
    });

    test("abort/connect/network errors expose the expected classifications", () => {
        const cause = new Error("boom");

        const aborted = new RequestAbortedError(cause, {
            url: "http://example.test/abort",
            method: "GET",
        });

        const timeout = new ConnectTimeoutError(cause, {
            host: "example.test",
            port: 443,
        });

        const network = new ConnectionError(cause, {
            host: "example.test",
            port: 443,
        });

        expect(aborted.code).toBe(FetchErrorCode.ABORTED);
        expect(aborted.phase).toBe("request");
        expect(aborted.retryable).toBe(false);
        expect(aborted.type).toBe(ErrorType.ABORTED);

        expect(timeout.code).toBe(FetchErrorCode.TIMEOUT);
        expect(timeout.phase).toBe("connect");
        expect(timeout.retryable).toBe(true);
        expect(timeout.type).toBe(ErrorType.TIMEOUT);

        expect(network.code).toBe(FetchErrorCode.CONNECTION);
        expect(network.phase).toBe("connect");
        expect(network.retryable).toBe(true);
        expect(network.type).toBe(ErrorType.NETWORK);
    });

    test("agent/policy errors expose specific metadata", () => {
        const busy = new AgentBusyError({
            origin: "http://example.test",
            host: "example.test",
            port: 80,
        });

        const mismatch = new OriginMismatchError(
            "http://a.test",
            "http://b.test",
            { url: "http://b.test/resource" },
        );

        const unsupportedMethod = new UnsupportedMethodError("CONNECT", {
            url: "http://example.test",
            method: "CONNECT",
        });

        expect(busy.code).toBe(FetchErrorCode.AGENT_BUSY);
        expect(busy.phase).toBe("agent");
        expect(busy.retryable).toBe(true);

        expect(mismatch.code).toBe(FetchErrorCode.ORIGIN_MISMATCH);
        expect(mismatch.phase).toBe("policy");
        expect(mismatch.retryable).toBe(false);
        expect(mismatch.context?.details?.expectedOrigin).toBe("http://a.test");
        expect(mismatch.context?.details?.actualOrigin).toBe("http://b.test");

        expect(unsupportedMethod.code).toBe(FetchErrorCode.UNSUPPORTED_METHOD);
        expect(unsupportedMethod.phase).toBe("policy");
        expect(unsupportedMethod.retryable).toBe(false);
    });

    test("HTTP status errors classify 4xx and 5xx correctly", () => {
        const http4xx = new HttpStatusError(404, {
            url: "http://example.test/not-found",
            method: "GET",
        });

        const http5xx = new HttpStatusError(503, {
            url: "http://example.test/unavailable",
            method: "GET",
        });

        expect(http4xx.code).toBe(FetchErrorCode.HTTP_STATUS);
        expect(http4xx.phase).toBe("response");
        expect(http4xx.retryable).toBe(false);
        expect(http4xx.type).toBe(ErrorType.HTTP_CLIENT_ERROR);
        expect(http4xx.statusCode).toBe(404);

        expect(http5xx.code).toBe(FetchErrorCode.HTTP_STATUS);
        expect(http5xx.phase).toBe("response");
        expect(http5xx.retryable).toBe(true);
        expect(http5xx.type).toBe(ErrorType.HTTP_SERVER_ERROR);
        expect(http5xx.statusCode).toBe(503);
    });

    test("toJSON exposes the stable diagnostic payload", () => {
        const cause = new Error("boom");
        const error = new ResponseBodyError(cause, {
            url: "http://example.test/stream",
            method: "GET",
        });

        expect(error.toJSON()).toEqual({
            name: "ResponseBodyError",
            message: "Failed while reading response body",
            code: FetchErrorCode.RESPONSE_BODY,
            phase: "body",
            retryable: true,
            type: ErrorType.NETWORK,
            context: {
                url: "http://example.test/stream",
                method: "GET",
            },
            cause: {
                name: "Error",
                message: "boom",
            },
        });
    });
});
