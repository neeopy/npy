import { ProxyDialer } from "../src/dialers/proxy.ts";
import { createFetch } from "../src/fetch.ts";
import { HttpClient } from "../src/http-client.ts";

const proxyUrl = process.env.HTTP_PROXY ?? "http://127.0.0.1:8080";

const client = new HttpClient({
    dialer: new ProxyDialer(proxyUrl),
    poolMaxPerHost: 16,
    poolMaxIdlePerHost: 4,
    connect: {
        keepAlive: true,
        noDelay: true,
    },
});

const fetch = createFetch(client);

try {
    const response = await fetch("https://httpbin.org/ip");

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    console.log("proxy:", proxyUrl);
    console.log("origin seen by server:", data.origin);
} finally {
    await fetch.close();
}
