import { HttpClient } from "../src/http-client.ts";

const client = new HttpClient({
    poolMaxPerHost: 32,
    poolMaxIdlePerHost: 8,
    connect: {
        keepAlive: true,
        noDelay: true,
    },
    io: {
        reader: {
            highWaterMark: 16 * 1024,
            maxHeaderSize: 64 * 1024,
            maxLineSize: 64 * 1024,
            maxBufferedBytes: 256 * 1024,
            decompress: true,
        },
        writer: {
            highWaterMark: 16 * 1024,
            directWriteThreshold: 64 * 1024,
            coalesceBodyMaxBytes: 64 * 1024,
        },
    },
});

try {
    const response = await client.send({
        url: "https://httpbin.org/anything",
        method: "POST",
        headers: new Headers({
            "content-type": "application/json",
            "x-example": "advanced-http-client",
        }),
        body: JSON.stringify({
            source: "HttpClient.send",
            features: ["pooling", "custom I/O", "raw Response access"],
        }),
    });

    console.log("status:", response.status);
    console.log("headers:", Object.fromEntries(response.headers.entries()));

    const data = await response.json();
    console.log("echoed json:", data.json);
} finally {
    await client.close();
}
