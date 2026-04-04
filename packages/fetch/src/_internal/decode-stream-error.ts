/**
 * Internal sentinel thrown when a decompression stream fails.
 *
 * Tagged at the source (inside createDecoder) so that error classifiers
 * can use `instanceof` instead of heuristics on error messages or codes.
 * Never exposed in the public API — callers receive ResponseDecodeError.
 */
export class DecodeStreamError extends Error {
    readonly cause: unknown;

    constructor(cause: unknown) {
        super("Response decode failed", { cause });
        this.name = "DecodeStreamError";
        this.cause = cause;
    }
}
