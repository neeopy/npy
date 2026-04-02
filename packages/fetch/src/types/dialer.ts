import type { ITcpConnection, ITlsConnection } from "@fuman/net";
import type { NodeTlsConnectOptions } from "@fuman/node";

export interface Dialer {
    dial(
        target: Dialer.Target,
        options?: Dialer.Options,
    ): Promise<Dialer.ConnectionLike>;
}

export namespace Dialer {
    export type ConnectionLike = ITcpConnection | ITlsConnection;

    export interface Target {
        address: string;
        port: number;
        secure: boolean;

        /** Server Name Indication (TLS). Defaults to the host when applicable. */
        sni?: string;

        /** Defaults to ["http/1.1"] when omitted by the dialer implementation. */
        alpnProtocols?: string[];

        /** Extra Node.js TLS options (minVersion, servername, etc.). */
        extraOptions?: NodeTlsConnectOptions["extraOptions"];
    }

    export interface Options {
        signal?: AbortSignal;
    }
}

/** Back-compat */
export type ConnectionLike = Dialer.ConnectionLike;
/** Back-compat */
export interface DialTarget extends Dialer.Target {}
