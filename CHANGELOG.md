# Changelog

All notable changes to `zilaws-server` are documented in this file.

## [3.0.0] - 2026-06-28

### Added

- **Bun runtime support** with automatic server wrapper selection (`NodeServerWrapper` on Node.js, `BunServerWrapper` on Bun).
- New cookie syncing system via the `/zilaws/cookieSync` HTTP endpoint.
- `cookieSyncAllowedOrigins` server setting to restrict which HTTP origins may call the cookie sync endpoint (CORS).
- `sessionTokenCookieName` server setting (default: `zilaSession`) for per-tab cookie sync isolation.
- `reusePort` option for Bun load-balancing across multiple processes on the same port.
- `https.allowSelfSigned` option for connecting with self-signed TLS certificates during development.
- `ServerWrapper` abstraction shared by Node and Bun server implementations.
- Bun-based test runner support (`bun test`).

### Changed

- Cookie updates from the server are delivered through the cookie sync flow instead of mutating cookies directly on an open WebSocket connection.
- Server internals refactored into wrapper-based architecture for multi-runtime support.
- Updated dev tooling and CI workflows for Bun-based cross-package testing and npm trusted publishing.

### Fixed

- Improved cookie session handling so multiple browser tabs can sync cookies independently via session tokens.

## [2.3.0] - Previous release

- General improvements and dependency updates.
