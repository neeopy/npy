import { fetch } from "../src";

// Simple GET request using the default fetch-compatible client.
const response = await fetch("https://httpbin.org/get");

if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
}

const data = await response.json();

console.log("status:", response.status);
console.log("origin:", data.origin);
console.log("url:", data.url);

// Optional for deterministic teardown in tests or short-lived scripts.
// Not required just to let the process exit naturally.
// await fetch.close();
