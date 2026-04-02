import bytes from "bytes";

type TransferEncodingInfo = {
    has: boolean;
    chunked: boolean;
    codings: string[];
};

export function parseMaxBytes(value?: number | string): number | null {
    if (value === undefined) return null;

    if (typeof value === "number") {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error(`invalid max size: ${String(value)}`);
        }
        return Math.floor(value);
    }

    const parsed = bytes.parse(value);
    if (parsed == null || !Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`invalid max size: ${String(value)}`);
    }

    return parsed;
}

export function splitTokens(v: string | null): string[] {
    if (!v) return [];
    return v
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

export function parseTransferEncoding(headers: Headers): TransferEncodingInfo {
    const raw = headers.get("transfer-encoding");
    const tks = splitTokens(raw);
    if (tks.length === 0) return { has: false, chunked: false, codings: [] };

    const chunkedIdx = tks.lastIndexOf("chunked");
    const hasChunked = chunkedIdx !== -1;

    if (hasChunked && chunkedIdx !== tks.length - 1) {
        throw new Error(`Invalid transfer-encoding order: ${raw ?? ""}`);
    }

    if (hasChunked && tks.indexOf("chunked") !== chunkedIdx) {
        throw new Error(
            `Invalid transfer-encoding (duplicate chunked): ${raw ?? ""}`,
        );
    }

    const codings = tks.filter((t) => t !== "chunked" && t !== "identity");

    return { has: true, chunked: hasChunked, codings };
}

export function parseContentLength(headers: Headers): number | null {
    const raw = headers.get("content-length");
    if (!raw) return null;

    const parts = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    if (parts.length === 0) return null;

    let value: number | null = null;

    for (const p of parts) {
        if (!/^\d+$/.test(p)) throw new Error(`Invalid content-length: ${raw}`);
        const n = Number.parseInt(p, 10);
        if (!Number.isFinite(n) || n < 0)
            throw new Error(`Invalid content-length: ${raw}`);

        if (value === null) value = n;
        else if (value !== n)
            throw new Error(`Conflicting content-length values: ${raw}`);
    }

    return value;
}
