import type { BodyInit } from "../body";
import type { LineReader, Readers } from "../io/readers";
import type { Writers } from "../io/writers";
import type { Dialer } from "./dialer";

export interface Agent {
    [Symbol.dispose](): void;
    close(): void;

    readonly hostname: string;
    readonly port: number;

    /**
     * Sends a single HTTP request and returns the raw {@link Response}.
     *
     * @remarks
     * The returned response body preserves the advanced error mapping of this library.
     * Limits configured through reader options are enforced while the body is consumed.
     */
    send(options: Agent.SendOptions): Promise<Response>;

    whenIdle(): Promise<void>;

    readonly isIdle: boolean;
    readonly lastUsed: number;
}

export namespace Agent {
    export interface ConnectOptions {
        timeout?: number;

        keepAlive?: boolean | null;

        noDelay?: boolean;
    }

    export type ReaderOptions = Readers.Options & LineReader.ReadHeadersOptions;

    export type WriterOptions = Writers.Options;

    export interface IOOptions {
        reader?: ReaderOptions;
        writer?: WriterOptions;
    }

    export interface Options {
        connect?: ConnectOptions;
        io?: IOOptions;
    }

    export interface SendOptions {
        url: string | URL;

        method: string;

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

        poolIdleTimeout?: number | false;

        connect?: Agent.ConnectOptions;

        io?: Agent.IOOptions;
    }
}

export interface AgentConnectOptions extends Agent.ConnectOptions {}

export interface AgentPoolOptions extends AgentPool.Options {}

export interface SendOptions extends Agent.SendOptions {}

export interface AgentIOOptions extends Agent.IOOptions {}

export type AgentReaderOptions = Agent.ReaderOptions;

export type AgentWriterOptions = Agent.WriterOptions;
