import { Readable } from "node:stream";
import { nodeReadableToWeb } from "@fuman/node";

type ByteStream = ReadableStream<Uint8Array>;
type ByteSource = ByteStream | AsyncIterable<Uint8Array>;
type ByteTransform = TransformStream<Uint8Array, Uint8Array>;

function applyTransforms(
    stream: ByteSource,
    contentEncoding: string | string[] | undefined,
    factory: (contentEncoding?: string | string[]) => ByteTransform[],
): ByteSource {
    const transforms = factory(contentEncoding);
    if (transforms.length === 0) return stream;

    // When transforms are required, always operate as Web Streams to use pipeThrough.
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
 * Create a series of decoding streams based on the content-encoding header. The
 * resulting streams should be piped together to decode the content.
 *
 * @see {@link https://datatracker.ietf.org/doc/html/rfc9110#section-8.4.1}
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

            // identity is not valid for Content-Encoding (it is for Accept-Encoding).
            if (normalizedEncoding === "identity") continue;

            decoders.push(createDecoder(normalizedEncoding));
        }
    }

    // Decoding must be applied in reverse order of encoding.
    return decoders.reverse();
}

/**
 * Create a series of encoding streams based on the content-encoding header (or
 * transfer-coding list).
 *
 * The resulting streams should be piped together to apply the encoding in the
 * declared order.
 *
 * @see {@link https://datatracker.ietf.org/doc/html/rfc9110#section-8.4.1}
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

function normalizeEncoding(encoding: string) {
    // https://www.rfc-editor.org/rfc/rfc7231#section-3.1.2.1
    // > All content-coding values are case-insensitive...
    return encoding.trim().toLowerCase();
}

function createDecoder(normalizedEncoding: string): ByteTransform {
    switch (normalizedEncoding) {
        // https://www.rfc-editor.org/rfc/rfc9112.html#section-7.2
        case "gzip":
        case "x-gzip":
            return new DecompressionStream("gzip") as ByteTransform;
        case "deflate":
        case "x-deflate":
            return new DecompressionStream("deflate") as ByteTransform;
        case "zstd":
        case "x-zstd":
            return new DecompressionStream("zstd" as any) as ByteTransform;
        case "br":
            return new DecompressionStream("brotli" as any) as ByteTransform;
        case "identity":
            return new TransformStream(); // Pass-through
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
            return new TransformStream(); // Pass-through
        default:
            throw new TypeError(
                `Unsupported content-encoding: "${normalizedEncoding}"`,
            );
    }
}
