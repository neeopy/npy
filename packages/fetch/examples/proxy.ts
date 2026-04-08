import { fetch } from "../src";

// Pass a proxy URL explicitly.
// Supported schemes include HTTP, HTTPS and SOCKS5.
const proxyUrl = process.env.HTTP_PROXY ?? "http://proxy.example.com:8080";

const response = await fetch("https://httpbin.org/ip", {
    proxy: proxyUrl,
});

if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
}

const data = await response.json();

console.log("proxy:", proxyUrl);
console.log("origin seen by server:", data.origin);

// To bypass environment proxies for a single request:
//
// const direct = await fetch("https://httpbin.org/ip", {
//     proxy: null,
// });
