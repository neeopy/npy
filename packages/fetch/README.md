# @npy/fetch

an http/1.1 client built over raw tcp sockets with a fetch-compatible api, per-origin connection pooling, and first-class proxy support.

> [!NOTE]
> node and bun only — does not work in the browser.

## install
```sh
bun add @npy/fetch
# or
npm install @npy/fetch
```

## usage

### simple fetch
```ts
import { fetch } from '@npy/fetch'

const response = await fetch('https://httpbin.org/anything')
const body = await response.json()
console.log(body)

fetch.close()
```

### with http/s proxy
```ts
import { createFetch, HttpClient } from '@npy/fetch'
import { ProxyDialer } from '@npy/fetch/dialers'

const fetch = createFetch(new HttpClient({
    dialer: new ProxyDialer('http://user:pass@proxy.example.com:8080'),
}))

const response = await fetch('https://httpbin.org/ip')
console.log(await response.json())

fetch.close()
```

### with socks proxy
```ts
import { createFetch, HttpClient } from '@npy/fetch'
import { ProxyDialer } from '@npy/fetch/dialers'

const fetch = createFetch(new HttpClient({
    dialer: new ProxyDialer('socks5://user:pass@proxy.example.com:1080'),
}))

const response = await fetch('https://httpbin.org/ip')
console.log(await response.json())

fetch.close()
```

### custom i/o options
```ts
import { HttpClient } from '@npy/fetch'

const client = new HttpClient({
    poolMaxPerHost: 10,
    poolMaxIdlePerHost: 5,
    poolIdleTimeout: 30_000,
    connect: {
        keepAlive: true,
        noDelay: true,
        timeout: 5_000,
    },
    io: {
        reader: {
            bufferSize: 32 * 1024,
            highWaterMark: 16 * 1024,
            maxHeaderSize: 16 * 1024,
            maxBodySize: '10mb',
            decompress: true,
        },
        writer: {
            highWaterMark: 16 * 1024,
            coalesceBodyMaxBytes: 64 * 1024,
        },
    },
})

const response = await client.send({ url: 'https://httpbin.org/anything', method: 'GET' })
console.log(await response.json())

await client.close()
```

### using `HttpClient` directly
```ts
import { HttpClient } from '@npy/fetch'

const client = new HttpClient()

const response = await client.send({
    url: 'https://httpbin.org/post',
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({ hello: 'world' }),
})

console.log(await response.json())
await client.close()
```

---

based on [deno-simple-fetch](https://github.com/esroyo/deno-simple-fetch).