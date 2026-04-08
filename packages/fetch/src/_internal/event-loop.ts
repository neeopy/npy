import type { Dialer } from "../types/dialer";

export interface RefableHandle {
    ref?: () => void;
    unref?: () => void;
}

type ConnectionWithSocket = Dialer.ConnectionLike & {
    socket?: unknown;
};

function isRefableHandle(value: unknown): value is RefableHandle {
    if (value == null || typeof value !== "object") {
        return false;
    }

    const maybeHandle = value as RefableHandle;
    return (
        typeof maybeHandle.ref === "function" ||
        typeof maybeHandle.unref === "function"
    );
}

export function getConnectionHandle(
    conn: Dialer.ConnectionLike | undefined,
): RefableHandle | null {
    if (!conn || typeof conn !== "object") {
        return null;
    }

    const socket = (conn as ConnectionWithSocket).socket;
    return isRefableHandle(socket) ? socket : null;
}

export function refConnection(conn: Dialer.ConnectionLike | undefined): void {
    // This is intentionally best-effort.
    // Non-Node transports may not expose a ref-able handle.
    try {
        getConnectionHandle(conn)?.ref?.();
    } catch {}
}

export function unrefConnection(conn: Dialer.ConnectionLike | undefined): void {
    // This is intentionally best-effort.
    // Idle connections should not keep the event loop alive on their own.
    try {
        getConnectionHandle(conn)?.unref?.();
    } catch {}
}

export function unrefTimer(
    timer: ReturnType<typeof setTimeout> | undefined,
): void {
    // Node and Bun expose unref() on timer handles.
    // Other runtimes may not, so this must stay non-throwing.
    try {
        (timer as { unref?: () => void } | undefined)?.unref?.();
    } catch {}
}
