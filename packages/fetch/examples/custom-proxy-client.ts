import { ProxyDialer } from "../src/dialers/proxy";
import { createFetch } from "../src/fetch";
import { HttpClient } from "../src/http-client";

// Using ProxyDialer with a custom HTTP client for explicit proxy control
const proxyUrl = process.env.HTTP_PROXY || "http://proxy.example.com:8080";

const client = new HttpClient({
    // Use ProxyDialer for all connections through this client
    dialer: new ProxyDialer(proxyUrl),

    // Configure connection pooling
    poolMaxPerHost: 16,
    poolMaxIdlePerHost: 4,
    poolIdleTimeout: 30_000,

    // TCP socket options
    connect: {
        keepAlive: true,
        noDelay: true,
        timeout: 5_000,
    },
});

const fetch = createFetch(client);

try {
    const response = await fetch("https://httpbin.org/ip");

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    console.log("✓ Request made through ProxyDialer");
    console.log("  proxy:", proxyUrl);
    console.log("  origin seen by server:", data.origin);
} finally {
    await client.close();
}
