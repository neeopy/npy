import { fetch } from "../src/fetch";

const response = await fetch("https://httpbin.org/anything");

if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
}

const data = await response.json();

console.log("status:", response.status);
console.log("url:", data.url);
console.log("headers sent:", data.headers);

await fetch.close();
