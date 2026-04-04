import { fetch } from "../src/fetch";

// Using a proxy with the built-in fetch client
// Supports HTTP, HTTPS, and SOCKS5 proxies
const proxyUrl = process.env.HTTP_PROXY || "http://proxy.example.com:8080";

const response = await fetch("https://httpbin.org/ip", {
    proxy: proxyUrl,
});

if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
}

const data = await response.json();

console.log("✓ Request routed through proxy");
console.log("  origin seen by server:", data.origin);

// Also works with SOCKS5:
// const response = await fetch('https://example.com', {
//   proxy: 'socks5://user:password@proxy.example.com:1080'
// })

await fetch.close();
