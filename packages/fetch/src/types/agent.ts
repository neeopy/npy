import type { BodyInit } from "../body";
import type { LineReader, Readers } from "../io/readers";
import type { Writers } from "../io/writers";
import type { Dialer } from "./dialer";

export interface Agent {
    [Symbol.dispose](): void;
    close(): void;

    readonly hostname: string;
    readonly port: number;

    send(options: Agent.SendOptions): Promise<Response>;
    whenIdle(): Promise<void>;

    readonly isIdle: boolean;
    readonly lastUsed: number;
}

export namespace Agent {
    export interface ConnectOptions {
        /** Connection timeout (ms) used only while establishing the socket. */
        timeout?: number;

        /**
         * Configure SO_KEEPALIVE on the underlying connection.
         *
         * - `true` / `false`: explicitly set the flag
         * - `null`: do not touch the runtime default
         */
        keepAlive?: boolean | null;

        /**
         * Configure TCP_NODELAY on the underlying connection.
         *
         * This is a connection-level option only; it is not related to HTTP body
         * buffering or writer coalescing.
         */
        noDelay?: boolean;
    }

    /**
     * Reader options currently supported by the low-level HTTP response parser.
     *
     * These options are applied per-agent / per-pool, not per-request.
     */
    export type ReaderOptions = Readers.Options & LineReader.ReadHeadersOptions;

    /**
     * Writer options currently supported by the low-level HTTP request writer.
     *
     * These options are applied per-agent / per-pool, not per-request.
     */
    export type WriterOptions = Writers.Options;

    /**
     * High-level HTTP I/O configuration forwarded to the low-level Readers/Writers.
     */
    export interface IOOptions {
        reader?: ReaderOptions;
        writer?: WriterOptions;
    }

    /**
     * Complete agent-level configuration.
     *
     * `connect` controls socket establishment behavior.
     * `io` controls HTTP reader/writer behavior.
     */
    export interface Options {
        connect?: ConnectOptions;
        io?: IOOptions;
    }

    export interface SendOptions {
        /**
         * Absolute request URL.
         *
         * Relative URLs are not supported at this layer.
         */
        url: string | URL;

        /**
         * HTTP method.
         *
         * The implementation may normalize casing before serialization.
         */
        method: string;

        /**
         * Pre-normalized headers for the low-level send path.
         *
         * Use `normalizeHeaders(...)` from the fetch layer when starting from a
         * generic `HeadersInit`.
         */
        headers?: Headers;

        body?: BodyInit | null;
        signal?: AbortSignal;
    }
}

export interface AgentPool {
    [Symbol.asyncDispose](): Promise<void>;
    close(): Promise<void>;

    readonly hostname: string;
    readonly port: number;

    send(options: Agent.SendOptions): Promise<Response>;
}

export namespace AgentPool {
    export interface Options {
        dialer?: Dialer;

        poolMaxIdlePerHost?: number;
        poolMaxPerHost?: number;

        /** `false` disables idle eviction. Defaults are handled by the implementation. */
        poolIdleTimeout?: number | false;

        /**
         * Publicly exposed socket/connection options.
         */
        connect?: Agent.ConnectOptions;

        /**
         * Publicly exposed HTTP I/O options forwarded to Readers/Writers.
         *
         * These are client/pool/agent-level settings, not per-request options.
         */
        io?: Agent.IOOptions;
    }
}

/** Back-compat */
export interface AgentConnectOptions extends Agent.ConnectOptions {}
/** Back-compat */
export interface AgentPoolOptions extends AgentPool.Options {}
/** Back-compat */
export interface SendOptions extends Agent.SendOptions {}
/** Back-compat */
export interface AgentIOOptions extends Agent.IOOptions {}
/** Back-compat */
export type AgentReaderOptions = Agent.ReaderOptions;
/** Back-compat */
export type AgentWriterOptions = Agent.WriterOptions;
