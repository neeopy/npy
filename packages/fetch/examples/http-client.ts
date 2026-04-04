import { HttpClient } from "../src/http-client";

// Create a custom HTTP client with advanced configuration
const client = new HttpClient({
    // Connection pooling
    poolMaxPerHost: 32,
    poolMaxIdlePerHost: 8,
    poolIdleTimeout: 30_000,

    // TCP socket options
    connect: {
        keepAlive: true,
        noDelay: true,
        timeout: 5_000,
    },

    // I/O configuration for performance tuning
    io: {
        reader: {
            bufferSize: 32 * 1024,
            readChunkSize: 16 * 1024,
            maxHeaderSize: 64 * 1024,
            maxLineSize: 64 * 1024,
            maxBufferedBytes: 256 * 1024,
            decompress: true,
        },
        writer: {
            writeBufferSize: 16 * 1024,
            directWriteThreshold: 64 * 1024,
            coalesceBodyMaxBytes: 64 * 1024,
        },
    },
});

try {
    const response = await client.send({
        url: "https://httpbin.org/post",
        method: "POST",
        headers: new Headers({
            "content-type": "application/json",
        }),
        body: JSON.stringify({
            message: "Custom HTTP client with advanced I/O configuration",
            timestamp: new Date().toISOString(),
        }),
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    console.log("status:", response.status);
    const data = await response.json();
    console.log("response data:", data.json);
} finally {
    await client.close();
}
