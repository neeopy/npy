/**
 * Create a ReadableStream from a Uint8Array.
 *
 * The stream will emit the entire byte array as a single chunk,
 * then close immediately.
 *
 * @param bytes - The byte array to wrap.
 * @returns A ReadableStream that emits the bytes.
 */
export function bytesToStream(bytes: Uint8Array) {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(bytes);
            controller.close();
        },
    });
}

/**
 * A TransformStream that limits the total number of bytes passed through.
 *
 * It accumulates the byte count from incoming chunks and enqueues them
 * if the total remains within the limit; otherwise, it errors.
 *
 * @param maxBytes - The maximum allowed bytes before erroring.
 */
export class MaxBytesTransformStream extends TransformStream<
    Uint8Array,
    Uint8Array
> {
    constructor(maxBytes: number) {
        // Note: negation accounts for invalid value types (NaN, non numbers)
        if (!(maxBytes >= 0)) {
            throw new TypeError("maxBytes must be a non-negative number");
        }

        let bytesRead = 0;

        super({
            transform: (
                chunk: Uint8Array,
                ctrl: TransformStreamDefaultController<Uint8Array>,
            ) => {
                if ((bytesRead += chunk.length) <= maxBytes) {
                    ctrl.enqueue(chunk);
                } else {
                    ctrl.error(new Error("Response too large"));
                }
            },
        });
    }
}
