# Changelog

All notable changes to this package will be documented in this file.

## [Unreleased]

### Changed

- Replaced the previous `generic-pool`-based agent pooling with an internal pool implementation tailored to the package lifecycle and connection reuse model.
- Idle pooled connections are now unref'ed when they become reusable, allowing the process to exit naturally when nothing else is pending.
- Pool maintenance timers are also unref'ed so they do not keep the event loop alive on their own.
- `fetch.close()` and `HttpClient.close()` remain available for deterministic teardown, but are no longer required solely to let the process exit after requests complete.
- Documentation and examples now reflect the current lifecycle semantics: explicit close is optional for natural process exit and recommended for predictable shutdown.

### Added

- Added internal event-loop liveness helpers for connection handles and timers.
- Added GC-backed response cleanup tracking so abandoned responses can conservatively release the transport when their object graph becomes unreachable.
- Added clone-aware response GC tracking so cleanup only runs after the final tracked clone is gone.
- Added a deterministic manual backend for GC cleanup tests.
- Added coverage for:
  - connection/timer ref/unref helpers
  - natural process exit with idle pooled connections
  - GC cleanup bookkeeping
  - clone-aware GC tracking
  - repeated abandoned-response cleanup without wedging the agent

### Fixed

- Fixed pool lifecycle semantics so agents are only released after the active request cycle has installed the correct idle promise.
- Fixed test coverage around reusable scripted connections to better reflect real socket behavior.
- Tightened response GC tracking to avoid unnecessary strong references in the clone-tracking path.

### Internal

- Removed the `generic-pool` dependency from the package runtime dependencies.
- Kept runtime GC-finalizer tests deterministic by using a manual collection backend in unit tests instead of depending on Bun finalizer timing.
- Added documentation comments around the manual GC test backend to explain the Bun limitation that makes real-GC tests nondeterministic.

### Docs

- Updated all examples to use the current public entrypoint shape.
- Refactored the README to match the current API surface, proxy behavior, lifecycle model and advanced client configuration.
- Added this changelog.