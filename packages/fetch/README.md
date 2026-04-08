# @npy/fetch

HTTP/1.1 client built on raw TCP sockets with a fetch-compatible API, per-origin connection pooling, explicit proxy support, and low-level primitives for custom transports and I/O tuning.

> [!NOTE]
> Node.js and Bun only. This package does not run in the browser.

## Install

```sh
bun add @npy/fetch
npm install @npy/fetch
```

## What it provides

- `fetch`: a fetch-compatible client with connection pooling
- `createFetch()`: create isolated fetch-like instances
- `HttpClient`: lower-level reusable client with pool and I/O configuration
- `ProxyDialer`, `TcpDialer`, `TlsDialer`, `AutoDialer`: transport selection
- `Agent` and `AgentPool`: lower-level request/pool primitives
- advanced error types for the non-weblike APIs

## Quick start

```ts
import { fetch } from "@npy/fetch";

const response = await fetch("https://httpbin.org/get");

if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
}

const data = await response.json();

console.log("status:", response.status);
console.log("origin:", data.origin);
```

`fetch.close()` is still available, but it is no longer required just to let the process exit after requests complete and pooled connections return to idle. It remains useful for deterministic shutdown in tests, CLIs and explicit teardown paths.

```ts
await fetch.close();
```

## Request options

The fetch-like API accepts standard `RequestInfo` / `RequestInit` input and preserves the expected web-style surface:

- `method`, `headers`, `body`, `signal`
- `redirect`: `"follow"` | `"manual"` | `"error"`
- `proxy`
- `proxy: null` to disable environment proxy resolution for that request

```ts
import { fetch } from "@npy/fetch";

const response = await fetch("https://httpbin.org/post", {
    method: "POST",
    headers: {
        "content-type": "application/json",
    },
    body: JSON.stringify({
        hello: "world",
    }),
});

console.log(await response.json());
```

## Proxies

### Explicit proxy URL

```ts
import { fetch } from "@npy/fetch";

const response = await fetch("https://httpbin.org/ip", {
    proxy: "http://user:password@proxy.example.com:8080",
});

console.log(await response.json());
```

Supported proxy schemes include HTTP, HTTPS and SOCKS5.

### Disable environment proxies per request

```ts
import { fetch } from "@npy/fetch";

const response = await fetch("https://httpbin.org/ip", {
    proxy: null,
});
```

### Environment proxy resolution

When no explicit proxy is provided, the fetch-like API can use proxy settings from the environment.

Common variables:

- `HTTP_PROXY`
- `HTTPS_PROXY`
- `SOCKS5_PROXY`
- `SOCKS_PROXY`

## Custom client

Use `HttpClient` when you want explicit pool sizing, socket behavior or I/O limits.

```ts
import { HttpClient } from "@npy/fetch";

const client = new HttpClient({
    poolMaxPerHost: 32,
    poolMaxIdlePerHost: 8,
    poolIdleTimeout: 30_000,
    connect: {
        keepAlive: true,
        noDelay: true,
        timeout: 5_000,
    },
    io: {
        reader: {
            bufferSize: 32 * 1024,
            readChunkSize: 16 * 1024,
            maxHeaderSize: 64 * 1024,
            maxLineSize: 64 * 1024,
            maxBufferedBytes: 256 * 1024,
            maxBodySize: "25mb",
            maxDecodedBodySize: "50mb",
            maxChunkSize: 16 * 1024 * 1024,
            decompress: true,
        },
        writer: {
            writeBufferSize: 16 * 1024,
            directWriteThreshold: 64 * 1024,
            coalesceBodyMaxBytes: 64 * 1024,
        },
    },
});

try {
    const response = await client.send({
        url: "https://httpbin.org/post",
        method: "POST",
        headers: new Headers({
            "content-type": "application/json",
        }),
        body: JSON.stringify({
            message: "advanced client",
        }),
    });

    console.log(await response.json());
} finally {
    await client.close();
}
```

## Custom fetch instance

Use `createFetch()` to create an isolated fetch-like function bound to a specific `HttpClient`.

```ts
import { HttpClient, createFetch } from "@npy/fetch";

const client = new HttpClient({
    poolMaxPerHost: 16,
    poolMaxIdlePerHost: 4,
});

const fetchLike = createFetch(client);

try {
    const response = await fetchLike("https://httpbin.org/get");
    console.log(await response.json());
} finally {
    await fetchLike.close();
}
```

## Explicit proxy transport with ProxyDialer

For fully explicit transport control, build a client with a dialer.

```ts
import { HttpClient, ProxyDialer, createFetch } from "@npy/fetch";

const client = new HttpClient({
    dialer: new ProxyDialer("http://user:password@proxy.example.com:8080"),
    poolMaxPerHost: 16,
    poolMaxIdlePerHost: 4,
    poolIdleTimeout: 30_000,
    connect: {
        keepAlive: true,
        noDelay: true,
        timeout: 5_000,
    },
});

const proxiedFetch = createFetch(client);

try {
    const response = await proxiedFetch("https://httpbin.org/ip");
    console.log(await response.json());
} finally {
    await proxiedFetch.close();
}
```

## Error model

There are two layers:

### Weblike API (`fetch`, `createFetch()`)

This layer behaves like platform `fetch` as closely as practical:

- network failures reject with `TypeError`
- aborts preserve `AbortError`
- `AbortSignal.timeout()` preserves `TimeoutError`
- body-read failures surface as web-style errors

### Advanced API (`HttpClient`, `Agent`, `AgentPool`)

These APIs preserve the library's richer error classes, including:

- `ConnectionError`
- `ConnectTimeoutError`
- `RequestAbortedError`
- `RequestWriteError`
- `ResponseHeaderError`
- `ResponseBodyError`
- `ResponseDecodeError`
- `HttpStatusError`

Use this layer if you need retry classification, context-rich diagnostics or explicit transport control.

## Limits and capabilities

- HTTP/1.1 only
- Node.js and Bun only
- transparent response decompression is supported through reader options
- request body encoding and transfer/content delimitation are handled automatically
- per-origin pooling is built in

## Exports

The package root exports the public surface, including:

- `fetch`, `createFetch`, `normalizeHeaders`
- `HttpClient`
- `createAgent`, `createAgentPool`
- `TcpDialer`, `TlsDialer`, `AutoDialer`, `ProxyDialer`
- body helpers, encoders, errors and public types

Use root imports:

```ts
import {
    fetch,
    createFetch,
    HttpClient,
    ProxyDialer,
    AutoDialer,
} from "@npy/fetch";
```

## License

MIT License © 2026 matheus fernandes

Based on [deno-simple-fetch](https://github.com/esroyo/deno-simple-fetch).
