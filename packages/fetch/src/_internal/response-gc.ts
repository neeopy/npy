import { trackedResponseSymbol } from "./symbols";

export interface ResponseGcController {
    track(response: Response): Response;
    finalize(): void;
}

interface ResponseCollectionToken {
    readonly stateRef: WeakRef<ResponseGcState>;
}

export interface ResponseCollectionBackend {
    readonly available: boolean;
    register(target: object, token: ResponseCollectionToken): void;
    unregister(token: ResponseCollectionToken): void;
}

type TrackedResponse = Response & {
    [trackedResponseSymbol]?: true;
};

const responsePrototypeClone = Response.prototype.clone;

class ResponseGcState {
    finalized = false;
    liveResponses = 0;
    readonly unregisterTokens = new Set<ResponseCollectionToken>();

    constructor(readonly onCollected: () => void) {}

    add(token: ResponseCollectionToken): void {
        if (this.finalized) return;

        this.liveResponses += 1;
        this.unregisterTokens.add(token);
    }

    collect(token: ResponseCollectionToken): void {
        if (this.finalized) return;
        if (!this.unregisterTokens.delete(token)) return;

        this.liveResponses -= 1;

        if (this.liveResponses === 0) {
            this.finalized = true;
            this.unregisterTokens.clear();
            this.onCollected();
        }
    }

    finalize(): ResponseCollectionToken[] {
        if (this.finalized) return [];

        this.finalized = true;

        const tokens = Array.from(this.unregisterTokens);
        this.unregisterTokens.clear();
        this.liveResponses = 0;

        return tokens;
    }
}

function dispatchCollected(token: ResponseCollectionToken): void {
    token.stateRef.deref()?.collect(token);
}

class FinalizationRegistryResponseCollectionBackend
    implements ResponseCollectionBackend
{
    readonly available: boolean;
    readonly #registry: FinalizationRegistry<
        WeakRef<ResponseCollectionToken>
    > | null;

    constructor() {
        this.available =
            typeof FinalizationRegistry === "function" &&
            typeof WeakRef === "function";

        this.#registry = this.available
            ? new FinalizationRegistry<WeakRef<ResponseCollectionToken>>(
                  (tokenRef) => {
                      try {
                          const token = tokenRef.deref();
                          if (!token) return;

                          dispatchCollected(token);
                      } catch {}
                  },
              )
            : null;
    }

    register(target: object, token: ResponseCollectionToken): void {
        if (!this.#registry) return;

        this.#registry.register(target, new WeakRef(token), token);
    }

    unregister(token: ResponseCollectionToken): void {
        this.#registry?.unregister(token);
    }
}

/*
 * Deterministic GC cleanup tests use a test-only backend.
 *
 * Reasons:
 * - Real-GC tests are unreliable in Bun.
 * - Bun does not presently ensure synchronous, repeat-until-stable
 *   delivery of FinalizationRegistry callbacks after Bun.gc(true).
 *
 * Reference:
 * - https://github.com/oven-sh/bun/issues/24285
 */
export class ManualResponseCollectionBackend
    implements ResponseCollectionBackend
{
    readonly available = true;

    readonly #tokensByTarget = new Map<object, ResponseCollectionToken>();
    readonly #targetsByToken = new Map<ResponseCollectionToken, object>();

    get size(): number {
        return this.#tokensByTarget.size;
    }

    register(target: object, token: ResponseCollectionToken): void {
        this.#tokensByTarget.set(target, token);
        this.#targetsByToken.set(token, target);
    }

    unregister(token: ResponseCollectionToken): void {
        const target = this.#targetsByToken.get(token);
        if (target === undefined) return;

        this.#targetsByToken.delete(token);
        this.#tokensByTarget.delete(target);
    }

    collect(target: object): boolean {
        const token = this.#tokensByTarget.get(target);
        if (!token) return false;

        this.#tokensByTarget.delete(target);
        this.#targetsByToken.delete(token);

        dispatchCollected(token);
        return true;
    }

    collectAll(): number {
        const targets = Array.from(this.#tokensByTarget.keys());
        for (const target of targets) {
            this.collect(target);
        }
        return targets.length;
    }
}

let activeBackend: ResponseCollectionBackend =
    new FinalizationRegistryResponseCollectionBackend();

export function setResponseCollectionBackendForTesting(
    backend: ResponseCollectionBackend | null,
): () => void {
    const previousBackend = activeBackend;
    activeBackend =
        backend ?? new FinalizationRegistryResponseCollectionBackend();

    return () => {
        activeBackend = previousBackend;
    };
}

export function createResponseGcController(
    onCollected: () => void,
    options: {
        backend?: ResponseCollectionBackend;
    } = {},
): ResponseGcController {
    const backend = options.backend ?? activeBackend;
    const state = new ResponseGcState(onCollected);

    const finalize = (): void => {
        const tokens = state.finalize();

        for (const token of tokens) {
            backend.unregister(token);
        }
    };

    const track = (response: Response): Response => {
        if (state.finalized || !backend.available) {
            return response;
        }

        const tracked = response as TrackedResponse;

        if (tracked[trackedResponseSymbol]) {
            return response;
        }

        Object.defineProperty(response, trackedResponseSymbol, {
            configurable: true,
            enumerable: false,
            writable: false,
            value: true,
        });

        Object.defineProperty(response, "clone", {
            configurable: true,
            enumerable: false,
            writable: false,
            value: function (this: Response): Response {
                return track(responsePrototypeClone.call(this));
            },
        });

        const token: ResponseCollectionToken = {
            stateRef: new WeakRef(state),
        };

        state.add(token);
        backend.register(response, token);

        return response;
    };

    return {
        track,
        finalize,
    };
}
