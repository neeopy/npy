# @npy/fetch

An HTTP/1.1 client built on raw TCP sockets with a fetch-compatible API, per-origin connection pooling, and first-class proxy support.

> [!NOTE]
> Node.js and Bun only — does not work in the browser.

## Install

```sh
bun add @npy/fetch
npm install @npy/fetch
```

## Usage

### Simple fetch

```ts
import { fetch } from '@npy/fetch'

const response = await fetch('https://httpbin.org/get')
const data = await response.json()
console.log(data)

await fetch.close()
```

### With proxy

Pass a proxy URL directly to the fetch options:

```ts
import { fetch } from '@npy/fetch'

const response = await fetch('https://httpbin.org/ip', {
    proxy: 'http://user:password@proxy.example.com:8080'
})
console.log(await response.json())

await fetch.close()
```

Supports HTTP, HTTPS, and SOCKS5 proxies:

```ts
// SOCKS5
await fetch('https://example.com', {
    proxy: 'socks5://user:password@proxy.example.com:1080'
})
```

### POST request

```ts
import { fetch } from '@npy/fetch'

const response = await fetch('https://httpbin.org/post', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hello: 'world' })
})
console.log(await response.json())

await fetch.close()
```

### Custom HTTP client

For fine-grained control over connection pooling and I/O:

```ts
import { HttpClient } from '@npy/fetch'

const client = new HttpClient({
    poolMaxPerHost: 32,
    poolMaxIdlePerHost: 8,
    connect: {
        keepAlive: true,
        noDelay: true,
    },
    io: {
        reader: {
            bufferSize: 32 * 1024,
            maxHeaderSize: 64 * 1024,
            maxBodySize: '50mb',
            decompress: true,
        },
        writer: {
            writeBufferSize: 16 * 1024,
            directWriteThreshold: 64 * 1024,
        },
    },
})

const response = await client.send({
    url: 'https://httpbin.org/post',
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({ data: 'example' }),
})

console.log(await response.json())
await client.close()
```

### With ProxyDialer

Use `ProxyDialer` for explicit proxy configuration with custom HTTP client:

```ts
import { createFetch, HttpClient } from '@npy/fetch'
import { ProxyDialer } from '@npy/fetch/dialers'

const client = new HttpClient({
    dialer: new ProxyDialer('http://user:password@proxy.example.com:8080'),
    poolMaxPerHost: 16,
    poolMaxIdlePerHost: 4,
})

const fetch = createFetch(client)
const response = await fetch('https://httpbin.org/ip')
console.log(await response.json())

await client.close()
```

Supports all proxy protocols:

```ts
// HTTP proxy
new ProxyDialer('http://proxy.example.com:8080')

// HTTPS proxy
new ProxyDialer('https://proxy.example.com:8443')

// SOCKS5 proxy
new ProxyDialer('socks5://proxy.example.com:1080')

// With authentication
new ProxyDialer('socks5://user:password@proxy.example.com:1080')
```

## API

### `fetch(input, init?)`

Standard Fetch API with additional options:

- `proxy?: string | ProxyInfo | null` — Proxy URL (http, https, socks5)
- `client?: HttpClient` — Custom HTTP client instance

### `HttpClient` options

**Pool:**

- `poolMaxPerHost` (default: `10`)
- `poolMaxIdlePerHost` (default: `5`)
- `poolIdleTimeout` (default: `30000` ms)

**Connection:**

- `connect.timeout` (default: `5000` ms)
- `connect.keepAlive` (default: `true`)
- `connect.noDelay` (default: `true`)

**Reader:**

- `io.reader.bufferSize` — Internal buffer size
- `io.reader.readChunkSize` — Chunk read size
- `io.reader.maxHeaderSize` — Maximum header size
- `io.reader.maxBodySize` — Maximum body size
- `io.reader.maxLineSize` — Maximum line size
- `io.reader.maxBufferedBytes` — Max buffered before processing
- `io.reader.decompress` (default: `true`) — Auto-decompress gzip/deflate

**Writer:**

- `io.writer.writeBufferSize` — Write buffer size
- `io.writer.directWriteThreshold` — Direct write threshold
- `io.writer.coalesceBodyMaxBytes` — Coalesce writes up to this size

## Environment Variables

The library respects standard proxy environment variables:

- `HTTP_PROXY` — HTTP proxy URL
- `HTTPS_PROXY` — HTTPS proxy URL
- `SOCKS5_PROXY` — SOCKS5 proxy URL
- `SOCKS_PROXY` — Alternative SOCKS proxy URL

These are used when no explicit proxy is configured.

## Limitations

- **HTTP/1.1 only** — Does not support HTTP/2 or HTTP/3
- **Node.js and Bun** — Browser environments are not supported
- **Limited to standard HTTP methods** — GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS

## License

MIT License © 2026 matheus fernandes

Based on [deno-simple-fetch](https://github.com/esroyo/deno-simple-fetch).
