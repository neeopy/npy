export const ErrorType = {
    ABORTED: "ABORTED",
    NETWORK: "NETWORK",
    TIMEOUT: "TIMEOUT",
    HTTP_CLIENT_ERROR: "HTTP_CLIENT_ERROR",
    HTTP_SERVER_ERROR: "HTTP_SERVER_ERROR",
} as const;

export type ErrorType = (typeof ErrorType)[keyof typeof ErrorType];

export const FetchErrorCode = {
    ABORTED: "ERR_FETCH_ABORTED",
    TIMEOUT: "ERR_FETCH_TIMEOUT",
    CONNECTION: "ERR_FETCH_CONNECTION",
    AGENT_CLOSED: "ERR_FETCH_AGENT_CLOSED",
    AGENT_BUSY: "ERR_FETCH_AGENT_BUSY",
    ORIGIN_MISMATCH: "ERR_FETCH_ORIGIN_MISMATCH",
    UNSUPPORTED_PROTOCOL: "ERR_FETCH_UNSUPPORTED_PROTOCOL",
    UNSUPPORTED_METHOD: "ERR_FETCH_UNSUPPORTED_METHOD",
    TLS_ALPN: "ERR_FETCH_TLS_ALPN",
    REQUEST_WRITE: "ERR_FETCH_REQUEST_WRITE",
    RESPONSE_HEADERS: "ERR_FETCH_RESPONSE_HEADERS",
    RESPONSE_BODY: "ERR_FETCH_RESPONSE_BODY",
    RESPONSE_DECODE: "ERR_FETCH_RESPONSE_DECODE",
    HTTP_STATUS: "ERR_FETCH_HTTP_STATUS",
} as const;

export type FetchErrorCode =
    (typeof FetchErrorCode)[keyof typeof FetchErrorCode];

export type FetchErrorPhase =
    | "agent"
    | "connect"
    | "request"
    | "response"
    | "body"
    | "decode"
    | "policy";

export interface FetchErrorContext {
    url?: string;
    method?: string;
    origin?: string;
    scheme?: string;
    host?: string;
    port?: number;
    status?: number;
    alpn?: string | null;
    details?: Record<string, unknown>;
}

export interface FetchErrorOptions {
    message: string;
    code: FetchErrorCode;
    phase: FetchErrorPhase;
    cause?: unknown;
    context?: FetchErrorContext;
    retryable?: boolean;
    type?: ErrorType;
}

export class FetchError extends Error {
    readonly code: FetchErrorCode;
    readonly phase: FetchErrorPhase;
    readonly context?: FetchErrorContext;
    readonly retryable: boolean;
    readonly type?: ErrorType;
    override readonly cause: unknown;

    constructor(options: FetchErrorOptions) {
        super(options.message, { cause: options.cause });
        this.code = options.code;
        this.phase = options.phase;
        this.context = options.context;
        this.retryable = options.retryable ?? false;
        this.type = options.type;
        this.cause = options.cause;
        Object.setPrototypeOf(this, new.target.prototype);
    }

    override get name(): string {
        return (this.constructor as typeof Error).name;
    }

    get [Symbol.toStringTag](): string {
        return this.name;
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            phase: this.phase,
            retryable: this.retryable,
            type: this.type,
            context: this.context,
            cause:
                this.cause instanceof Error
                    ? {
                          name: this.cause.name,
                          message: this.cause.message,
                      }
                    : this.cause,
        };
    }
}

export class RequestAbortedError extends FetchError {
    constructor(
        cause?: unknown,
        context?: FetchErrorContext,
        message?: string,
    ) {
        super({
            message: message ?? "The request was aborted",
            code: FetchErrorCode.ABORTED,
            phase: "request",
            cause,
            context,
            retryable: false,
            type: ErrorType.ABORTED,
        });
    }
}

export class ConnectTimeoutError extends FetchError {
    constructor(
        cause?: unknown,
        context?: FetchErrorContext,
        message?: string,
    ) {
        super({
            message: message ?? "Connection timed out",
            code: FetchErrorCode.TIMEOUT,
            phase: "connect",
            cause,
            context,
            retryable: true,
            type: ErrorType.TIMEOUT,
        });
    }
}

export class ConnectionError extends FetchError {
    constructor(
        cause?: unknown,
        context?: FetchErrorContext,
        message?: string,
    ) {
        super({
            message: message ?? "Network connection failed",
            code: FetchErrorCode.CONNECTION,
            phase: "connect",
            cause,
            context,
            retryable: true,
            type: ErrorType.NETWORK,
        });
    }
}

export class AgentClosedError extends FetchError {
    constructor(context?: FetchErrorContext, cause?: unknown) {
        super({
            message: "Agent is closed",
            code: FetchErrorCode.AGENT_CLOSED,
            phase: "agent",
            cause,
            context,
            retryable: false,
            type: ErrorType.NETWORK,
        });
    }
}

export class AgentBusyError extends FetchError {
    constructor(context?: FetchErrorContext, cause?: unknown) {
        super({
            message: "Agent is busy",
            code: FetchErrorCode.AGENT_BUSY,
            phase: "agent",
            cause,
            context,
            retryable: true,
            type: ErrorType.NETWORK,
        });
    }
}

export class OriginMismatchError extends FetchError {
    constructor(
        expectedOrigin: string,
        actualOrigin: string,
        context?: FetchErrorContext,
    ) {
        super({
            message: `Agent origin mismatch: expected ${expectedOrigin}, got ${actualOrigin}`,
            code: FetchErrorCode.ORIGIN_MISMATCH,
            phase: "policy",
            context: {
                ...context,
                details: {
                    ...(context?.details ?? {}),
                    expectedOrigin,
                    actualOrigin,
                },
            },
            retryable: false,
            type: ErrorType.NETWORK,
        });
    }
}

export class UnsupportedProtocolError extends FetchError {
    constructor(protocol: string, context?: FetchErrorContext) {
        super({
            message: `Unsupported protocol: ${protocol}`,
            code: FetchErrorCode.UNSUPPORTED_PROTOCOL,
            phase: "policy",
            context,
            retryable: false,
            type: ErrorType.NETWORK,
        });
    }
}

export class UnsupportedMethodError extends FetchError {
    constructor(method: string, context?: FetchErrorContext) {
        super({
            message: `Unsupported method: ${method}`,
            code: FetchErrorCode.UNSUPPORTED_METHOD,
            phase: "policy",
            context,
            retryable: false,
            type: ErrorType.NETWORK,
        });
    }
}

export class UnsupportedAlpnProtocolError extends FetchError {
    constructor(alpn: string, context?: FetchErrorContext, cause?: unknown) {
        super({
            message: `Unsupported ALPN protocol negotiated: ${alpn}`,
            code: FetchErrorCode.TLS_ALPN,
            phase: "connect",
            cause,
            context: {
                ...context,
                alpn,
            },
            retryable: false,
            type: ErrorType.NETWORK,
        });
    }
}

export class RequestWriteError extends FetchError {
    constructor(
        cause?: unknown,
        context?: FetchErrorContext,
        message?: string,
    ) {
        super({
            message: message ?? "Failed to write HTTP request",
            code: FetchErrorCode.REQUEST_WRITE,
            phase: "request",
            cause,
            context,
            retryable: true,
            type: ErrorType.NETWORK,
        });
    }
}

export class ResponseHeaderError extends FetchError {
    constructor(
        cause?: unknown,
        context?: FetchErrorContext,
        message?: string,
    ) {
        super({
            message: message ?? "Failed while reading response headers",
            code: FetchErrorCode.RESPONSE_HEADERS,
            phase: "response",
            cause,
            context,
            retryable: true,
            type: ErrorType.NETWORK,
        });
    }
}

export class ResponseBodyError extends FetchError {
    constructor(
        cause?: unknown,
        context?: FetchErrorContext,
        message?: string,
    ) {
        super({
            message: message ?? "Failed while reading response body",
            code: FetchErrorCode.RESPONSE_BODY,
            phase: "body",
            cause,
            context,
            retryable: true,
            type: ErrorType.NETWORK,
        });
    }
}

export class ResponseDecodeError extends FetchError {
    constructor(
        cause?: unknown,
        context?: FetchErrorContext,
        message?: string,
    ) {
        super({
            message: message ?? "Failed while decoding response body",
            code: FetchErrorCode.RESPONSE_DECODE,
            phase: "decode",
            cause,
            context,
            retryable: false,
            type: ErrorType.NETWORK,
        });
    }
}

export class HttpStatusError extends FetchError {
    readonly statusCode: number;

    constructor(
        statusCode: number,
        context?: FetchErrorContext,
        cause?: unknown,
        message?: string,
    ) {
        super({
            message: message ?? `HTTP ${statusCode}`,
            code: FetchErrorCode.HTTP_STATUS,
            phase: "response",
            cause,
            context: {
                ...context,
                status: statusCode,
            },
            retryable: statusCode >= 500,
            type:
                statusCode < 500
                    ? ErrorType.HTTP_CLIENT_ERROR
                    : ErrorType.HTTP_SERVER_ERROR,
        });

        this.statusCode = statusCode;
    }
}
