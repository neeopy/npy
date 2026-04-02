import type { ISyncWritable, IWritable } from "@fuman/io";
import { u8 } from "@fuman/utils";

const DEFAULT_BUF_SIZE = 4096;
const MIN_BUF_SIZE = 16;

export class BufWriter implements IWritable, ISyncWritable {
    #buffer: Uint8Array;
    #writable: IWritable;

    #writePos = 0;
    #error: Error | null = null;

    #pending: Uint8Array[] = [];
    #pendingBytes = 0;

    #lastWrite: { buf: Uint8Array; size: number; internal: boolean } | null =
        null;

    constructor(writable: IWritable, size: number = DEFAULT_BUF_SIZE) {
        if (size < MIN_BUF_SIZE) size = MIN_BUF_SIZE;
        this.#buffer = u8.alloc(size);
        this.#writable = writable;
    }

    get bufferSize(): number {
        return this.#buffer.byteLength;
    }

    get buffered(): number {
        return this.#pendingBytes + this.#writePos;
    }

    get available(): number {
        return this.#buffer.byteLength - this.#writePos;
    }

    reset(writable: IWritable): void {
        this.#error = null;
        this.#writePos = 0;
        this.#pending.length = 0;
        this.#pendingBytes = 0;
        this.#lastWrite = null;
        this.#writable = writable;
    }

    writeSync(bytes: number): Uint8Array {
        if (this.#error) throw this.#error;
        if (bytes < 0) throw new RangeError("bytes must be >= 0");
        if (this.#lastWrite)
            throw new Error(
                "disposeWriteSync must be called before the next writeSync",
            );

        if (bytes === 0) {
            const empty = this.#buffer.subarray(this.#writePos, this.#writePos);
            this.#lastWrite = { buf: empty, size: 0, internal: true };
            return empty;
        }

        if (bytes > this.available && this.#writePos > 0) {
            const copy = u8.allocWith(this.#buffer.subarray(0, this.#writePos));
            this.#pending.push(copy);
            this.#pendingBytes += copy.length;
            this.#writePos = 0;
        }

        if (bytes <= this.#buffer.byteLength) {
            if (bytes > this.available) {
                const copy = u8.allocWith(
                    this.#buffer.subarray(0, this.#writePos),
                );
                this.#pending.push(copy);
                this.#pendingBytes += copy.length;
                this.#writePos = 0;
            }

            const start = this.#writePos;
            const end = start + bytes;
            const slice = this.#buffer.subarray(start, end);
            this.#writePos = end;
            this.#lastWrite = { buf: slice, size: bytes, internal: true };
            return slice;
        }

        const chunk = u8.alloc(bytes);
        this.#lastWrite = { buf: chunk, size: bytes, internal: false };
        return chunk;
    }

    disposeWriteSync(written?: number): void {
        const lw = this.#lastWrite;
        if (!lw) return;

        const w = written ?? lw.size;
        if (w < 0 || w > lw.size) {
            throw new RangeError(`written out of bounds: ${w} (0..${lw.size})`);
        }

        if (lw.internal) {
            this.#writePos -= lw.size - w;
        } else {
            if (w > 0) {
                const chunk = w === lw.size ? lw.buf : lw.buf.subarray(0, w);
                this.#pending.push(chunk);
                this.#pendingBytes += chunk.length;
            }
        }

        this.#lastWrite = null;
    }

    async #flushPending(): Promise<void> {
        if (this.#error) throw this.#error;
        if (this.#lastWrite)
            throw new Error(
                "disposeWriteSync must be called before flush/write",
            );

        while (this.#pending.length > 0) {
            const chunk = this.#pending[0];
            try {
                await this.#writable.write(chunk);
            } catch (e) {
                this.#error = e as Error;
                throw e;
            }
            this.#pending.shift();
            this.#pendingBytes -= chunk.length;
        }
    }

    async flush(): Promise<void> {
        await this.#flushPending();
        if (this.#error) throw this.#error;
        if (this.#writePos === 0) return;

        try {
            await this.#writable.write(
                this.#buffer.subarray(0, this.#writePos),
            );
        } catch (e) {
            this.#error = e as Error;
            throw e;
        }

        this.#writePos = 0;
    }

    async write(bytes: Uint8Array): Promise<void> {
        if (this.#error) throw this.#error;
        if (!bytes.length) return;

        await this.#flushPending();

        if (this.#writePos === 0 && bytes.length >= this.#buffer.byteLength) {
            try {
                await this.#writable.write(bytes);
            } catch (e) {
                this.#error = e as Error;
                throw e;
            }
            return;
        }

        let off = 0;
        while (off < bytes.length) {
            if (this.available === 0) {
                await this.flush();
                continue;
            }

            const toCopy = Math.min(this.available, bytes.length - off);
            this.#buffer.set(bytes.subarray(off, off + toCopy), this.#writePos);
            this.#writePos += toCopy;
            off += toCopy;

            if (this.#writePos === this.#buffer.byteLength) {
                await this.flush();
            }
        }
    }
}
