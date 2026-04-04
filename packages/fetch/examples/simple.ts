import { fetch } from "../src/fetch";

// Simple GET request using the drop-in fetch replacement
const response = await fetch("https://httpbin.org/get");

if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
}

const data = await response.json();

console.log("status:", response.status);
console.log("origin:", data.origin);
console.log("user-agent:", data.headers["User-Agent"]);

// Always close the connection pool when done
await fetch.close();
