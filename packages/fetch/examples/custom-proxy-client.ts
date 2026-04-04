import { ProxyDialer } from "../src/dialers/proxy";
import { createFetch } from "../src/fetch";
import { HttpClient } from "../src/http-client";

const proxyUrl = process.env.HTTP_PROXY as string;

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
    await client.close();
}
