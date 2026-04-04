import { Readable } from "node:stream";
import { nodeReadableToWeb } from "@fuman/node";
import { DecodeStreamError } from "./_internal/decode-stream-error";

export type ByteStream = ReadableStream<Uint8Array>;
type ByteSource = ByteStream | AsyncIterable<Uint8Array>;
export type ByteTransform = TransformStream<Uint8Array, Uint8Array>;

function applyTransforms(
    stream: ByteSource,
    contentEncoding: string | string[] | undefined,
    factory: (contentEncoding?: string | string[]) => ByteTransform[],
): ByteSource {
    const transforms = factory(contentEncoding);
    if (transforms.length === 0) return stream;

    let result: ByteStream;

    if (stream instanceof ReadableStream) {
        result = stream;
    } else {
        result = nodeReadableToWeb(Readable.from(stream));
    }

    for (const t of transforms) {
        result = result.pipeThrough(t);
    }

    return result;
}

/**
 * Applies decoding transforms for the given content-encoding list.
 *
 * @remarks
 * If no supported encodings are provided, the original source is returned unchanged.
 * Async iterables are converted to Web Streams only when transforms are required.
 */
export function decodeStream(
    stream: ByteStream,
    contentEncoding?: string | string[],
): ByteStream;
export function decodeStream(
    stream: AsyncIterable<Uint8Array>,
    contentEncoding?: string | string[],
): AsyncIterable<Uint8Array> | ByteStream;
export function decodeStream(
    stream: ByteSource,
    contentEncoding?: string | string[],
): ByteSource {
    return applyTransforms(stream, contentEncoding, createDecoders);
}

/**
 * Applies encoding transforms for the given content-encoding list.
 *
 * @remarks
 * If no supported encodings are provided, the original source is returned unchanged.
 * Async iterables are converted to Web Streams only when transforms are required.
 */
export function encodeStream(
    stream: ByteStream,
    contentEncoding?: string | string[],
): ByteStream;
export function encodeStream(
    stream: AsyncIterable<Uint8Array>,
    contentEncoding?: string | string[],
): AsyncIterable<Uint8Array> | ByteStream;
export function encodeStream(
    stream: ByteSource,
    contentEncoding?: string | string[],
): ByteSource {
    return applyTransforms(stream, contentEncoding, createEncoders);
}

/**
 * Creates the decoder pipeline for a Content-Encoding or transfer-coding list.
 *
 * @remarks
 * Decoding is applied in reverse order of encoding, as required by HTTP semantics.
 * The special value `identity` is ignored.
 */
export function createDecoders(
    contentEncoding?: string | string[],
): ByteTransform[] {
    const decoders: ByteTransform[] = [];

    if (contentEncoding?.length) {
        const encodings: string[] = Array.isArray(contentEncoding)
            ? contentEncoding.flatMap(commaSplit)
            : contentEncoding.split(",");

        for (const encoding of encodings) {
            const normalizedEncoding = normalizeEncoding(encoding);

            if (normalizedEncoding === "identity") continue;

            decoders.push(createDecoder(normalizedEncoding));
        }
    }

    return decoders.reverse();
}

/**
 * Creates the encoder pipeline for a Content-Encoding or transfer-coding list.
 *
 * @remarks
 * Encoders are returned in the declared order. The special value `identity` is ignored.
 */
export function createEncoders(
    contentEncoding?: string | string[],
): ByteTransform[] {
    const encoders: ByteTransform[] = [];

    if (contentEncoding?.length) {
        const encodings: string[] = Array.isArray(contentEncoding)
            ? contentEncoding.flatMap(commaSplit)
            : contentEncoding.split(",");

        for (const encoding of encodings) {
            const normalizedEncoding = normalizeEncoding(encoding);

            if (normalizedEncoding === "identity") continue;

            encoders.push(createEncoder(normalizedEncoding));
        }
    }

    return encoders;
}

function commaSplit(header: string): string[] {
    return header.split(",");
}

function normalizeEncoding(encoding: string): string {
    return encoding.trim().toLowerCase();
}

function tagDecodeErrors(native: ByteTransform): ByteTransform {
    const reader = native.readable.getReader();

    const tagged = new ReadableStream<Uint8Array>({
        pull(controller) {
            return reader.read().then(
                ({ done, value }) => {
                    if (done) {
                        controller.close();
                    } else if (value) {
                        controller.enqueue(
                            value as unknown as Uint8Array<ArrayBuffer>,
                        );
                    }
                },
                (err) => {
                    controller.error(new DecodeStreamError(err));
                },
            );
        },
        cancel(reason) {
            return reader.cancel(reason);
        },
    });

    return {
        writable: native.writable,
        readable: tagged,
    } as ByteTransform;
}

function createDecoder(normalizedEncoding: string): ByteTransform {
    switch (normalizedEncoding) {
        case "gzip":
        case "x-gzip":
            return tagDecodeErrors(
                new DecompressionStream("gzip") as ByteTransform,
            );
        case "deflate":
        case "x-deflate":
            return tagDecodeErrors(
                new DecompressionStream("deflate") as ByteTransform,
            );
        case "zstd":
        case "x-zstd":
            return tagDecodeErrors(
                new DecompressionStream("zstd" as any) as ByteTransform,
            );
        case "br":
            return tagDecodeErrors(
                new DecompressionStream("brotli" as any) as ByteTransform,
            );
        case "identity":
            return new TransformStream();
        default:
            throw new TypeError(
                `Unsupported content-encoding: "${normalizedEncoding}"`,
            );
    }
}

function createEncoder(normalizedEncoding: string): ByteTransform {
    switch (normalizedEncoding) {
        case "gzip":
        case "x-gzip":
            return new CompressionStream("gzip") as ByteTransform;
        case "deflate":
        case "x-deflate":
            return new CompressionStream("deflate") as ByteTransform;
        case "zstd":
        case "x-zstd":
            return new CompressionStream("zstd" as any) as ByteTransform;
        case "br":
            return new CompressionStream("brotli" as any) as ByteTransform;
        case "identity":
            return new TransformStream();
        default:
            throw new TypeError(
                `Unsupported content-encoding: "${normalizedEncoding}"`,
            );
    }
}
