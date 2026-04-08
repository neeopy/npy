import { createFetch, HttpClient, ProxyDialer } from "../src";

// Create a dedicated client that always routes through the same proxy.
const proxyUrl = process.env.HTTP_PROXY ?? "http://proxy.example.com:8080";

const client = new HttpClient({
    dialer: new ProxyDialer(proxyUrl),
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

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    console.log("proxy:", proxyUrl);
    console.log("origin seen by server:", data.origin);
} finally {
    await client.close();
}
