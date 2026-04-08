import { HttpClient } from "../src";

// Create a reusable HTTP client with per-origin pooling and I/O tuning.
const client = new HttpClient({
    poolMaxPerHost: 32,
    poolMaxIdlePerHost: 8,
    poolIdleTimeout: 30_000,
    connect: {
        keepAlive: true,
        noDelay: true,
        timeout: 5_000,
    },
    io: {
        reader: {
            bufferSize: 32 * 1024,
            readChunkSize: 16 * 1024,
            maxHeaderSize: 64 * 1024,
            maxLineSize: 64 * 1024,
            maxBufferedBytes: 256 * 1024,
            maxBodySize: "25mb",
            maxDecodedBodySize: "50mb",
            maxChunkSize: 16 * 1024 * 1024,
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

    const data = await response.json();

    console.log("status:", response.status);
    console.log("response json:", data.json);
} finally {
    // Explicit close is still useful for predictable shutdown and tests.
    await client.close();
}
