import { fetch } from "../src/fetch";

const proxyUrl = "http://V0rk3M:phA3fT@186.179.61.64:9183";

const response = await fetch("https://httpbin.org/ip", { proxy: proxyUrl });

if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
}

const data = await response.json();

console.log("proxy:", proxyUrl);
console.log("origin seen by server:", data.origin);

await fetch.close();
