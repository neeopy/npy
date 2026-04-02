export function raceSignal<T>(
    promise: PromiseLike<T>,
    signal: AbortSignal,
): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => {
            function onAbort() {
                reject(signal.reason);
            }
            if (signal.aborted) {
                onAbort();
            } else {
                signal.addEventListener("abort", onAbort, { once: true });
                function cleanup() {
                    signal.removeEventListener("abort", onAbort);
                }
                promise.then(cleanup, cleanup);
            }
        }),
    ]);
}
