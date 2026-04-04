import { gzipSync } from "node:zlib";

export interface TestServer {
    server: ReturnType<typeof Bun.serve>;
    baseUrl: string;
    stop(): Promise<void>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function headersToObject(headers: Headers): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of headers.entries()) {
        out[key] = value;
    }
    return out;
}

function json(value: unknown, init?: ResponseInit): Response {
    return Response.json(value, init);
}

function textResponse(
    body: string,
    init?: ResponseInit & { headers?: Record<string, string> },
): Response {
    return new Response(body, {
        ...init,
        headers: {
            "content-type": "text/plain; charset=utf-8",
            ...(init?.headers ?? {}),
        },
    });
}

function headAwareText(
    request: Request,
    body: string,
    init?: ResponseInit & { headers?: Record<string, string> },
): Response {
    if (request.method === "HEAD") {
        return new Response(null, {
            ...init,
            headers: {
                "content-type": "text/plain; charset=utf-8",
                ...(init?.headers ?? {}),
            },
        });
    }

    return textResponse(body, init);
}

function headAwareJson(
    request: Request,
    body: unknown,
    init?: ResponseInit & { headers?: Record<string, string> },
): Response {
    if (request.method === "HEAD") {
        return new Response(null, {
            ...init,
            headers: {
                "content-type": "application/json",
                ...(init?.headers ?? {}),
            },
        });
    }

    return json(body, {
        ...init,
        headers: {
            "content-type": "application/json",
            ...(init?.headers ?? {}),
        },
    });
}

export function createTestServer(): TestServer {
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request: Request): Promise<Response> {
            const url = new URL(request.url);
            const headers = headersToObject(request.headers);

            switch (url.pathname) {
                case "/text": {
                    return headAwareText(request, "Hello, World!");
                }

                case "/json": {
                    return headAwareJson(request, { message: "Hello, JSON!" });
                }

                case "/echo": {
                    if (request.method === "HEAD") {
                        return new Response(null, {
                            status: 200,
                            headers: {
                                "content-type": "application/json",
                            },
                        });
                    }

                    const bodyBytes = new Uint8Array(
                        await request.arrayBuffer(),
                    );
                    const bodyText = decoder.decode(bodyBytes);

                    return json(
                        {
                            method: request.method,
                            url: `${url.pathname}${url.search}`,
                            headers,
                            bodyText,
                            bodyLength: bodyBytes.byteLength,
                        },
                        {
                            status: 200,
                            headers: {
                                "content-type": "application/json",
                            },
                        },
                    );
                }

                case "/slow": {
                    await sleep(200);
                    return textResponse("Finally!");
                }

                case "/slow-body": {
                    let sent = 0;

                    const stream = new ReadableStream<Uint8Array>({
                        async pull(controller) {
                            if (sent === 0) {
                                controller.enqueue(encoder.encode("part-1 "));
                                sent = 1;
                                return;
                            }

                            if (sent === 1) {
                                await sleep(200);
                                controller.enqueue(encoder.encode("part-2"));
                                controller.close();
                                sent = 2;
                            }
                        },
                    });

                    return new Response(stream, {
                        status: 200,
                        headers: {
                            "content-type": "text/plain; charset=utf-8",
                        },
                    });
                }

                case "/chunked": {
                    let index = 0;
                    const chunks = ["chunk1", "chunk2", "chunk3"];

                    const stream = new ReadableStream<Uint8Array>({
                        pull(controller) {
                            if (index >= chunks.length) {
                                controller.close();
                                return;
                            }

                            controller.enqueue(encoder.encode(chunks[index]));
                            index += 1;
                        },
                    });

                    return new Response(stream, {
                        status: 200,
                        headers: {
                            "content-type": "text/plain; charset=utf-8",
                        },
                    });
                }

                case "/gzip": {
                    const payload = gzipSync("This is compressed content!");

                    return new Response(payload, {
                        status: 200,
                        headers: {
                            "content-type": "text/plain; charset=utf-8",
                            "content-encoding": "gzip",
                            "content-length": String(payload.byteLength),
                        },
                    });
                }

                case "/bad-gzip": {
                    const payload = encoder.encode("not actually gzip");

                    return new Response(payload, {
                        status: 200,
                        headers: {
                            "content-type": "text/plain; charset=utf-8",
                            "content-encoding": "gzip",
                            "content-length": String(payload.byteLength),
                        },
                    });
                }

                case "/large": {
                    const body = "x".repeat(1024);

                    return textResponse(body, {
                        headers: {
                            "content-length": String(
                                encoder.encode(body).byteLength,
                            ),
                        },
                    });
                }

                case "/large-stream": {
                    let remaining = 32;

                    const stream = new ReadableStream<Uint8Array>({
                        pull(controller) {
                            if (remaining === 0) {
                                controller.close();
                                return;
                            }

                            controller.enqueue(encoder.encode("x".repeat(64)));
                            remaining -= 1;
                        },
                    });

                    return new Response(stream, {
                        status: 200,
                        headers: {
                            "content-type": "text/plain; charset=utf-8",
                        },
                    });
                }

                case "/huge-header": {
                    return new Response("ok", {
                        status: 200,
                        headers: {
                            "content-type": "text/plain; charset=utf-8",
                            "x-huge": "a".repeat(4096),
                        },
                    });
                }

                case "/redirect": {
                    return textResponse("Redirecting to /redirected-target", {
                        status: 302,
                        headers: {
                            location: "/redirected-target",
                        },
                    });
                }

                case "/redirected-target": {
                    return textResponse("You followed the redirect");
                }

                case "/multipart-echo": {
                    let fields: Record<string, unknown>;

                    try {
                        const formData = await request.formData();
                        fields = {};

                        for (const [key, value] of formData.entries()) {
                            const v = value as unknown;

                            if (v instanceof Blob) {
                                fields[key] = {
                                    type: "file",
                                    filename:
                                        "name" in v
                                            ? String((v as any).name)
                                            : "blob",
                                    mimeType: (v as Blob).type,
                                    size: (v as Blob).size,
                                    content: await (v as Blob).text(),
                                };
                            } else {
                                const existing = fields[key];
                                fields[key] =
                                    existing !== undefined
                                        ? [
                                              ...(Array.isArray(existing)
                                                  ? existing
                                                  : [existing]),
                                              value,
                                          ]
                                        : value;
                            }
                        }
                    } catch (err) {
                        return json({ error: String(err) }, { status: 400 });
                    }

                    return json({
                        method: request.method,
                        contentType: request.headers.get("content-type"),
                        contentLength: request.headers.get("content-length")
                            ? Number(request.headers.get("content-length"))
                            : null,
                        fields,
                    });
                }

                default: {
                    return textResponse("Not Found", { status: 404 });
                }
            }
        },
    });

    return {
        server,
        baseUrl: `http://${server.hostname}:${server.port}`,
        async stop() {
            await server.stop(true);
        },
    };
}
