import { Readable } from "node:stream";
import type { IClosable, IReadable } from "@fuman/io";

export interface FormDataPolyfill extends Readable {
    getBoundary(): string;
    getLengthSync(): number;
    hasKnownLength(): boolean;
}

export const isReadable = (object: any): object is Readable =>
    Boolean(Readable.isReadable(object));

export const isIterable = (
    object: any,
): object is AsyncIterable<any> | Iterable<any> =>
    typeof object?.[Symbol.asyncIterator] === "function" ||
    typeof object?.[Symbol.iterator] === "function";

export const isMultipartFormDataStream = (
    object: any,
): object is FormDataPolyfill =>
    typeof object?.getBoundary === "function" &&
    typeof object?.hasKnownLength === "function" &&
    typeof object?.getLengthSync === "function" &&
    Boolean(Readable.isReadable(object));

export const isFormData = (object: any): object is FormData =>
    typeof object === "object" &&
    typeof object?.append === "function" &&
    typeof object?.set === "function" &&
    typeof object?.get === "function" &&
    typeof object?.getAll === "function" &&
    typeof object?.delete === "function" &&
    typeof object?.keys === "function" &&
    typeof object?.values === "function" &&
    typeof object?.entries === "function" &&
    typeof object?.constructor === "function" &&
    object?.[Symbol.toStringTag] === "FormData";

export const isURLSearchParameters = (object: any): object is URLSearchParams =>
    typeof object === "object" &&
    typeof object?.append === "function" &&
    typeof object?.delete === "function" &&
    typeof object?.get === "function" &&
    typeof object?.getAll === "function" &&
    typeof object?.has === "function" &&
    typeof object?.set === "function" &&
    typeof object?.sort === "function" &&
    object?.[Symbol.toStringTag] === "URLSearchParams";

export const isReadableStream = (object: any): object is ReadableStream =>
    typeof object === "object" &&
    typeof object?.getReader === "function" &&
    typeof object?.cancel === "function" &&
    typeof object?.tee === "function";

export const isFumanReadable = (object: any): object is IReadable & IClosable =>
    typeof object?.read === "function" &&
    typeof object?.close === "function" &&
    !isReadable(object) &&
    !isReadableStream(object);

export const isBlob = (object: any): object is Blob => {
    if (
        typeof object === "object" &&
        object !== null &&
        typeof object.arrayBuffer === "function" &&
        typeof object.size === "number" &&
        typeof object.slice === "function" &&
        typeof object.stream === "function" &&
        typeof object.text === "function" &&
        typeof object.type === "string"
    ) {
        return true;
    }

    return false;
};
