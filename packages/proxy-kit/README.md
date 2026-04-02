# @npy/proxy-kit

utilities for parsing, stringifying, and validating proxy uris across multiple formats and protocols.

## install
```sh
bun add @npy/proxy-kit
# or
npm install @npy/proxy-kit
```

## usage

### parsing

supports `http`, `https`, `socks4`, `socks4a`, `socks5`, `socks5h` and multiple uri formats:
```ts
import { parse } from '@npy/proxy-kit'

// standard uri
parse('http://user:pass@proxy.example.com:8080', { strict: true })
// { protocol: 'http', host: 'proxy.example.com', port: 8080, user: 'user', password: 'pass' }

// host:port only (non-strict)
parse('127.0.0.1:8080')
// { host: '127.0.0.1', port: 8080 }

// host:port with default protocol (strict)
parse('127.0.0.1:8080', { strict: true, defaultProtocol: 'socks5' })
// { protocol: 'socks5', host: '127.0.0.1', port: 8080 }

// alternative formats
parse('user:pass:proxy.example.com:3128', { strict: true, defaultProtocol: 'http' })
parse('proxy.example.com:3128@user:pass', { strict: true, defaultProtocol: 'https' })

// socks alias normalizes to socks5
parse('socks://user:pass@proxy.example.com:1080', { strict: true })
// { protocol: 'socks5', ... }
```

### stringifying
```ts
import { stringify } from '@npy/proxy-kit'

stringify({ protocol: 'http', host: 'proxy.example.com', port: 8080, user: 'u', password: 'p' })
// 'http://u:p@proxy.example.com:8080'

stringify({ protocol: 'http', host: 'proxy.example.com', port: 8080 }, { format: 'ip:port' })
// 'http://proxy.example.com:8080'

// ipv6
stringify({ protocol: 'https', host: '2001:db8::1', port: 8443 }, { format: 'ip:port' })
// 'https://[2001:db8::1]:8443'
```

available formats: `ip:port`, `ip:port:user:pass`, `user:pass:ip:port`, `ip:port@user:pass`, `user:pass@ip:port`

### type guards
```ts
import { isHttp, isHttps, isHttpLike, isSocks, isSocks4, isSocks5, isTyped } from '@npy/proxy-kit'

const proxy = parse('socks5://proxy.example.com:1080', { strict: true })!

isSocks(proxy)  // true
isSocks5(proxy) // true
isHttp(proxy)   // false
isTyped(proxy)  // true
```