import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { isAnyArrayBuffer } from "node:util/types";
import { nodeReadableToWeb } from "@fuman/node";
import { utf8 } from "@fuman/utils";
import { CRLF_LENGTH, CRLF_STR } from "./_internal/consts";
import {
    type FormDataPolyfill,
    isBlob,
    isFormData,
    isIterable,
    isMultipartFormDataStream,
    isReadable,
    isReadableStream,
    isURLSearchParameters,
} from "./_internal/guards";

export type BodyInit =
    | Exclude<RequestInit["body"], undefined | null>
    | FormDataPolyfill
    | Readable;

export interface BodyState {
    contentLength: number | null;
    contentType: string | null;
    body: Readable | ReadableStream | Uint8Array | null;
}

type Bytes = Uint8Array<ArrayBufferLike>;

const BOUNDARY = "-".repeat(2);

const makeFormBoundary = (): string =>
    `formdata-${randomBytes(8).toString("hex")}`;

const getFormHeader = (
    boundary: string,
    name: string,
    field: File | Blob | string,
): string => {
    let header = `${BOUNDARY}${boundary}${CRLF_STR}`;
    header += `Content-Disposition: form-data; name="${name}"`;
    if (isBlob(field)) {
        header += `; filename="${(field as File).name ?? "blob"}"${CRLF_STR}`;
        header += `Content-Type: ${field.type || "application/octet-stream"}`;
    }
    return `${header}${CRLF_STR}${CRLF_STR}`;
};

const getFormFooter = (boundary: string) =>
    `${BOUNDARY}${boundary}${BOUNDARY}${CRLF_STR}${CRLF_STR}`;

export const getFormDataLength = (form: FormData, boundary: string) => {
    let length = Buffer.byteLength(getFormFooter(boundary));
    for (const [name, value] of form)
        length +=
            Buffer.byteLength(getFormHeader(boundary, name, value)) +
            (isBlob(value) ? value.size : Buffer.byteLength(`${value}`)) +
            CRLF_LENGTH;
    return length;
};

async function* generatorOfFormData(
    form: FormData,
    boundary: string,
): AsyncGenerator<Bytes> {
    for (const [name, value] of form) {
        if (isBlob(value)) {
            yield utf8.encoder.encode(
                getFormHeader(boundary, name, value),
            ) as Bytes;

            // ReadableStream -> AsyncIterable (via for-await, supported in modern runtimes; cast keeps TS happy)
            for await (const chunk of value.stream() as any as AsyncIterable<Bytes>) {
                yield chunk;
            }

            yield utf8.encoder.encode(CRLF_STR) as Bytes;
        } else {
            yield utf8.encoder.encode(
                getFormHeader(boundary, name, value) + value + CRLF_STR,
            ) as Bytes;
        }
    }
    yield utf8.encoder.encode(getFormFooter(boundary)) as Bytes;
}

export const extractBody = (object: BodyInit | null): BodyState => {
    let type: string | null = null;
    let body: Readable | ReadableStream | Uint8Array | null;
    let size: number | null = null;

    if (object == null) {
        body = null;
        size = 0;
    } else if (typeof object === "string") {
        const bytes = utf8.encoder.encode(`${object}`);
        type = "text/plain;charset=UTF-8";
        size = bytes.byteLength;
        body = bytes;
    } else if (isURLSearchParameters(object)) {
        const bytes = utf8.encoder.encode(object.toString());
        body = bytes;
        size = bytes.byteLength;
        type = "application/x-www-form-urlencoded;charset=UTF-8";
    } else if (isBlob(object)) {
        size = object.size;
        type = object.type || null;
        body = object.stream();
    } else if (object instanceof Uint8Array) {
        body = object;
        size = object.byteLength;
    } else if (isAnyArrayBuffer(object)) {
        const bytes = new Uint8Array(object);
        body = bytes;
        size = bytes.byteLength;
    } else if (ArrayBuffer.isView(object)) {
        const bytes = new Uint8Array(
            object.buffer,
            object.byteOffset,
            object.byteLength,
        );
        body = bytes;
        size = bytes.byteLength;
    } else if (isReadableStream(object)) {
        body = object;
    } else if (isFormData(object)) {
        const boundary = makeFormBoundary();
        type = `multipart/form-data; boundary=${boundary}`;
        size = getFormDataLength(object, boundary);
        body = Readable.from(generatorOfFormData(object, boundary));
    } else if (isMultipartFormDataStream(object)) {
        type = `multipart/form-data; boundary=${object.getBoundary()}`;
        size = object.hasKnownLength() ? object.getLengthSync() : null;
        body = object as Readable;
    } else if (isReadable(object)) {
        body = object as Readable;
    } else if (isIterable(object)) {
        body = Readable.from(object);
    } else {
        const bytes = utf8.encoder.encode(`${object}`);
        type = "text/plain;charset=UTF-8";
        body = bytes;
        size = bytes.byteLength;
    }

    return {
        contentLength: size,
        contentType: type,
        body,
    };
};

const kBodyInternals = Symbol("kBodyInternals");

const toWebBodyInit = (
    body: Readable | ReadableStream | Uint8Array | null,
): globalThis.BodyInit | null => {
    if (body == null) return null;
    if (isReadable(body)) {
        return nodeReadableToWeb(body);
    }
    return body as unknown as globalThis.BodyInit;
};

const bytesToArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
    const bytesAsArrayBuffer = new ArrayBuffer(bytes.byteLength);
    const bytesUint8 = new Uint8Array(bytesAsArrayBuffer);
    bytesUint8.set(bytes);
    return bytesAsArrayBuffer;
};

export class Body {
    private [kBodyInternals]: BodyState;

    constructor(init: BodyInit | null) {
        this[kBodyInternals] = extractBody(init);
    }

    get body() {
        return this[kBodyInternals].body;
    }

    get bodyUsed() {
        const { body } = this[kBodyInternals];
        if (isReadable(body)) return Readable.isDisturbed(body);
        if (isReadableStream(body)) return body.locked;
        return false;
    }

    async arrayBuffer(): Promise<ArrayBuffer> {
        const { body } = this[kBodyInternals];
        if (body == null) return new ArrayBuffer(0);
        if (body instanceof Uint8Array) return bytesToArrayBuffer(body);
        return new Response(toWebBodyInit(body)).arrayBuffer();
    }

    async formData() {
        const { body, contentLength, contentType } = this[kBodyInternals];
        const headers: Record<string, string> = {};
        if (contentLength != null)
            headers["Content-Length"] = String(contentLength);
        if (contentType != null) headers["Content-Type"] = contentType;
        return new Response(toWebBodyInit(body), { headers }).formData();
    }

    async blob() {
        const { body, contentType } = this[kBodyInternals];
        if (body == null) {
            return new Blob([], { type: contentType ?? "" });
        }
        if (body instanceof Uint8Array) {
            return new Blob(
                [
                    new Uint8Array(
                        body.buffer as ArrayBuffer,
                        body.byteOffset,
                        body.byteLength,
                    ),
                ],
                { type: contentType ?? "" },
            );
        }
        return new Response(toWebBodyInit(body), {
            headers: contentType ? { "Content-Type": contentType } : undefined,
        }).blob();
    }

    async json() {
        const text = await this.text();
        return JSON.parse(text);
    }

    async text() {
        const { body } = this[kBodyInternals];
        if (body == null) return "";
        if (body instanceof Uint8Array) {
            return utf8.decoder.decode(body);
        }
        return new Response(toWebBodyInit(body)).text();
    }
}
