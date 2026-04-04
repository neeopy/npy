import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { isAnyArrayBuffer } from "node:util/types";
import type { IClosable, IReadable } from "@fuman/io";
import { webReadableToFuman } from "@fuman/io";
import { utf8 } from "@fuman/utils";
import { CRLF_LENGTH, CRLF_STR } from "./_internal/consts";
import {
    type FormDataPolyfill,
    isBlob,
    isFormData,
    isFumanReadable,
    isIterable,
    isMultipartFormDataStream,
    isReadable,
    isReadableStream,
    isURLSearchParameters,
} from "./_internal/guards";

export type BodyInit =
    | Exclude<RequestInit["body"], undefined | null>
    | FormDataPolyfill
    | Readable
    | (IReadable & IClosable);

export interface BodyState {
    contentLength: number | null;
    contentType: string | null;

    body:
        | Readable
        | ReadableStream
        | Uint8Array
        | (IReadable & IClosable)
        | null;
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
    let body:
        | Readable
        | ReadableStream
        | Uint8Array
        | (IReadable & IClosable)
        | null;
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
    } else if (isFumanReadable(object)) {
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

export function fromRequestBody(request: Request): BodyInit | null {
    if (request.bodyUsed) {
        throw new TypeError("Request body has already been used");
    }

    if (request.body == null) {
        return null;
    }

    return webReadableToFuman(request.body);
}
