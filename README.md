# user-service

Microservice responsible for user CRUD, profile management, preferences, loyalty, subscriptions, and account-lifecycle operations. Part of a larger microservice ecosystem that shares a MongoDB database with the auth service.

## Architecture

```
user-service  (port 3501)
    │
    ├── MongoDB  (shared with auth-service — same users/roles/permissions collections)
    ├── Redis    (optional — rate limiting, falls back to in-memory)
    └── HTTP     (calls auth-service, email-service, notification-service, etc.)
```

Authentication is handled by **three modes**:

| Mode | Header | Used by |
|---|---|---|
| Bearer JWT | `Authorization: Bearer <token>` | End users |
| API key | `x-api-key: <key>` | Service-to-service |
| Gateway trust | `x-gateway-secret: <secret>` | API Gateway |

---

## Quick Start

### Local development

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in values
cp .env.example .env

# 3. Start development server (nodemon)
npm run dev
```

### Docker (full stack)

```bash
# Starts user-service + MongoDB 7 + Redis 7
docker compose up --build
```

The service is available at `http://localhost:3501`.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | `development` | `development` \| `production` \| `test` |
| `PORT` | No | `3501` | HTTP port |
| `MONGO_URI` | Yes | — | Full MongoDB connection string |
| `REDIS_URL` | No | — | Redis connection string (rate limiting) |
| `JWT_ACCESS_SECRET` | Yes | — | ≥32 char secret — **must match auth-service** |
| `JWT_REFRESH_SECRET` | Yes | — | ≥32 char secret — **must match auth-service** |
| `JWT_ID_SECRET` | Yes | — | ≥32 char secret — **must match auth-service** |
| `JWT_ALGORITHM` | No | `HS256` | JWT signing algorithm |
| `JWT_ACCESS_EXPIRY` | No | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRY` | No | `7d` | Refresh token TTL |
| `JWT_ISSUER` | Yes | — | JWT `iss` claim |
| `JWT_AUDIENCE` | Yes | — | JWT `aud` claim |
| `SERVICE_API_KEY` | Yes | — | API key this service uses when calling others |
| `ALLOWED_SERVICE_API_KEYS` | Yes | — | Comma-separated API keys allowed to call this service |
| `TRUST_GATEWAY` | No | `false` | Enable gateway trust mode |
| `GATEWAY_SECRET` | No | — | Shared secret with the API gateway |
| `CORS_ORIGIN` | No | `http://localhost:3000` | Comma-separated allowed origins |
| `AUTH_SERVICE_URL` | No | `http://localhost:3500` | Auth service base URL |
| `EMAIL_SERVICE_URL` | No | `http://localhost:3502` | Email service base URL |
| `ORDER_SERVICE_URL` | No | `http://localhost:3503` | Order service base URL |
| `CART_SERVICE_URL` | No | `http://localhost:3504` | Cart service base URL |
| `WISHLIST_SERVICE_URL` | No | `http://localhost:3505` | Wishlist service base URL |
| `NOTIFICATION_SERVICE_URL` | No | `http://localhost:3506` | Notification service base URL |
| `BCRYPT_ROUNDS` | No | `12` | bcrypt cost factor |
| `MAX_FILE_SIZE` | No | `5242880` | Upload size limit in bytes (5 MB) |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate-limit window in ms (15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | Max requests per window |
| `BULK_RATE_LIMIT_MAX` | No | `10` | Max bulk requests per window |
| `LOG_LEVEL` | No | `info` | Winston log level |
| `LOG_FORMAT` | No | `pretty` | `pretty` (dev) or `json` (prod) |

---

## API Routes

All routes are prefixed with `/api/users` unless stated otherwise.

### Health & Observability

| Method | Path | Description |
|---|---|---|
| `GET` | `/health/live` | Liveness probe — always 200 |
| `GET` | `/health/ready` | Readiness probe — checks DB + Redis |
| `GET` | `/health` | Full health report (uptime, memory, dependencies) |
| `GET` | `/metrics` | Prometheus metrics scrape endpoint |

Swagger UI is available at `/api-docs` when `NODE_ENV` is not `production`.

---

### Registration — Public

No authentication required.

| Method | Path | Body fields | Description |
|---|---|---|---|
| `POST` | `/api/users/register` | `email`*, `password`*, `firstName`, `lastName`, `username` | Self-registration; sends welcome email |

---

### Users — Core CRUD

All routes below require a valid JWT (or service API key).

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/users` | `users:read` | Paginated / filtered user list |
| `POST` | `/api/users` | `users:create` | Admin: create a user profile — **password not required** (user completes credentials via auth-service) |
| `GET` | `/api/users/:id` | owner \| admin | Get user by ID |
| `PUT` | `/api/users/:id` | owner \| admin | Full update |
| `PATCH` | `/api/users/:id` | owner \| admin | Partial update |
| `DELETE` | `/api/users/:id` | `users:delete` | Soft-delete |

`GET /api/users` query params: `page`, `limit`, `sortBy`, `sortOrder`, `status`, `role`, `search`.

---

### Users — Profile

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/users/profile` | authenticated | Own profile + statistics |
| `PUT` | `/api/users/:id/profile` | owner \| admin | Update profile fields |
| `PUT` | `/api/users/:id/profile/picture` | owner \| admin | Set avatar URL |
| `PUT` | `/api/users/:id/profile/email` | owner \| admin | Change email (triggers re-verification) |
| `PUT` | `/api/users/:id/profile/phone` | owner \| admin | Change phone number |

---

### Users — Authentication

> **Note:** `change-password`, `reset-password`, and `confirm-email` are owned by the **auth-service** and are not exposed here.

| Method | Path | Permission | Description |
|---|---|---|---|
| `PUT` | `/api/users/:id/authentication/verify` | `users:update` | Admin: force-mark a user as verified |

---

### Users — Account Status & Lifecycle

| Method | Path | Permission | Description |
|---|---|---|---|
| `PUT` | `/api/users/:id/status` | `users:update` | Set status (`active` / `inactive` / `banned` / `pending`) |
| `PUT` | `/api/users/:id/lock` | `users:update` | Lock account — body: `{ durationMinutes?, reason? }` |
| `PUT` | `/api/users/:id/unlock` | `users:update` | Unlock account |
| `PUT` | `/api/users/:id/deactivate-account` | `users:update` | Deactivate |
| `PUT` | `/api/users/:id/reactivate-account` | `users:update` | Reactivate |
| `PATCH` | `/api/users/:userId/activate` | `users:update` | Activate |
| `PATCH` | `/api/users/:userId/deactivate` | `users:update` | Deactivate |

---

### Users — Roles

| Method | Path | Permission | Description |
|---|---|---|---|
| `PATCH` | `/api/users/:userId/role` | `users:manage` | Assign a role to a user |

---

### Users — Preferences

| Method | Path | Permission | Description |
|---|---|---|---|
| `PUT` | `/api/users/:id/preferences` | owner \| admin | Update all preference fields at once |
| `PUT` | `/api/users/:id/preferences/newsletter` | owner \| admin | Toggle newsletter subscription |
| `PUT` | `/api/users/:id/preferences/notifications` | owner \| admin | Toggle push notifications |
| `PUT` | `/api/users/:id/preferences/theme` | owner \| admin | Set UI theme (`light` / `dark` / `system`) |
| `PUT` | `/api/users/:id/preferences/language` | owner \| admin | Set language (ISO 639-1 code, e.g. `en`) |

---

### Users — Subscription

| Method | Path | Permission | Description |
|---|---|---|---|
| `PUT` | `/api/users/:id/subscription` | `users:update` | Update subscription plan / status |
| `DELETE` | `/api/users/:id/subscription` | `users:update` | Cancel subscription |

---

### Users — Loyalty

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/users/:id/loyalty/add` | `users:update` | Add loyalty points — body: `{ points }` |
| `POST` | `/api/users/:id/loyalty/redeem` | owner | Redeem loyalty points — body: `{ points }` |
| `POST` | `/api/users/:id/loyalty/transfer` | owner | Transfer points to another user — body: `{ toUserId, points }` |
| `PUT` | `/api/users/:id/loyalty/reset` | `users:update` | Reset points to zero |

---

### Users — Interests

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/users/:id/interests` | owner \| admin | Add an interest tag |
| `DELETE` | `/api/users/:id/interests` | owner \| admin | Remove an interest tag |
| `POST` | `/api/users/:id/interests/category` | owner \| admin | Add an interest category |
| `DELETE` | `/api/users/:id/interests/clear` | owner \| admin | Clear all interests |

---

### Users — Favorites

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/users/:id/favorites` | owner \| admin | Add a favourite product |
| `DELETE` | `/api/users/:id/favorites` | owner \| admin | Remove a favourite product |

---

### Users — Addresses

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/users/:id/addresses` | owner \| admin | Add address — body: `{ street*, city*, country* (ISO 2), isDefault? }` |
| `PUT` | `/api/users/:id/addresses/:addressId` | owner \| admin | Update address |
| `DELETE` | `/api/users/:id/addresses/:addressId` | owner \| admin | Delete address |
| `PATCH` | `/api/users/:id/addresses/:addressId/default` | owner \| admin | Set as default address |

---

### Users — Sessions & Security

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/users/:id/security` | owner \| admin | Security info (lockout, TOTP, verified flags) |
| `GET` | `/api/users/:id/sessions` | owner \| admin | Active sessions |
| `GET` | `/api/users/:id/devices/trusted` | owner \| admin | Trusted devices |
| `GET` | `/api/users/:id/devices/known` | owner \| admin | Known devices |
| `GET` | `/api/users/:id/login-history` | owner \| admin | Login history |
| `GET` | `/api/users/:id/security/logs` | `users:read` | Security event log |
| `POST` | `/api/users/:id/sessions/invalidate-all` | `users:update` | Invalidate all active sessions |
| `POST` | `/api/users/:id/sessions/revoke-token` | owner | Revoke a specific refresh token |
| `PUT` | `/api/users/:id/login-timestamp` | `users:update` | Update last-login timestamp |
| `PUT` | `/api/users/:id/failed-logins/increment` | `users:update` | Increment failed-login counter |
| `PUT` | `/api/users/:id/failed-logins/reset` | `users:update` | Reset failed-login counter |

---

### Users — Social Media

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/users/:id/social` | owner \| admin | Get linked social accounts |
| `PUT` | `/api/users/:id/social-media` | owner \| admin | Update social media profile URLs |
| `POST` | `/api/users/:id/social-media/link` | owner \| admin | Link a social provider — body: `{ platform, socialId, email?, displayName? }` |
| `DELETE` | `/api/users/:id/social-media/unlink` | owner \| admin | Unlink a social provider — body: `{ platform }` |
| `DELETE` | `/api/users/:id/social-media/clear` | `users:update` | Clear all social links |

---

### Users — Reporting

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/users/:id/statistics` | owner \| admin | Computed statistics for a specific user |
| `GET` | `/api/users/:id/report` | owner \| admin | Full report (security, activity, preferences) |
| `GET` | `/api/users/:id/activity-summary` | owner \| admin | Activity summary |
| `PUT` | `/api/users/:id/dynamic-update` | `users:update` | Update a single field dynamically — body: `{ field, value }` |

---

### Users — Notifications

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/users/:id/notify` | `users:update` | Send a notification to a user |

---

### Search & Filters

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/users/search` | `users:read` | Full-text search (`q` param, min 2 chars) |
| `GET` | `/api/users/search/email-username` | `users:read` | Search by email or username |
| `GET` | `/api/users/search/dynamic` | `users:read` | Dynamic field search |
| `GET` | `/api/users/advanced-search` | `users:read` | Advanced filtered search |
| `GET` | `/api/users/by-email/:email` | `users:read` | Exact lookup by email |
| `GET` | `/api/users/by-username/:username` | `users:read` | Exact lookup by username |
| `GET` | `/api/users/filter/status` | `users:read` | Filter by status (`status` param) |
| `GET` | `/api/users/filter/active` | `users:read` | Active users only |
| `GET` | `/api/users/filter/verified` | `users:read` | Verified users only |
| `GET` | `/api/users/filter/role` | `users:read` | Filter by role (`role` param) |
| `GET` | `/api/users/filter/admins` | `users:read` | Admin and super-admin users |
| `GET` | `/api/users/filter/customers` | `users:read` | Customer users |
| `GET` | `/api/users/filter/subscription` | `users:read` | Filter by subscription type (`subscriptionType` param) |
| `GET` | `/api/users/filter/active-within-days` | `users:read` | Active in last N days (`days` param, default 30) |
| `GET` | `/api/users/filter/top-loyal` | `users:read` | Top users by loyalty points (`limit` param) |
| `GET` | `/api/users/filter/never-logged-in` | `users:read` | Users who have never logged in |
| `GET` | `/api/users/filter/oldest` | `users:read` | Oldest registered user |
| `GET` | `/api/users/filter/failed-logins` | `users:read` | Users with failed login attempts (`threshold` param, default 5) |
| `GET` | `/api/users/filter/incomplete-profiles` | `users:read` | Users with incomplete profiles |

---

### Bulk Operations

All bulk routes enforce an additional lower rate limit.

| Method | Path | Permission | Description |
|---|---|---|---|
| `DELETE` | `/api/users/bulk` | `users:delete` | Bulk delete by IDs |
| `PUT` | `/api/users/bulk` | `users:update` | Bulk field update |
| `PATCH` | `/api/users/bulk/status` | `users:update` | Bulk status change |
| `PUT` | `/api/users/bulk/update-role` | `users:update` | Bulk role assignment |
| `POST` | `/api/users/bulk/add-loyalty-points` | `users:update` | Bulk loyalty point addition |

---

### Analytics

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/users/stats-data` | `users:view` | Summary statistics (totals, role breakdown) |
| `GET` | `/api/users/analytics` | `users:view` | Dashboard analytics — 30 / 7 day windows |
| `GET` | `/api/users/analytics/count-by-role` | `users:view` | User count grouped by role |
| `GET` | `/api/users/analytics/count-by-subscription` | `users:view` | Count by subscription type |
| `GET` | `/api/users/analytics/count-by-country` | `users:view` | Count by country |
| `GET` | `/api/users/analytics/average-loyalty-points` | `users:view` | Average loyalty points |
| `GET` | `/api/users/analytics/average-orders` | `users:view` | Average orders per user |
| `GET` | `/api/users/analytics/loyalty-brackets` | `users:view` | Loyalty bracket distribution |
| `GET` | `/api/users/analytics/top-interests` | `users:view` | Most common interest tags |
| `GET` | `/api/users/analytics/registrations-over-time` | `users:view` | Registration trend |
| `GET` | `/api/users/analytics/login-activity-over-time` | `users:view` | Login activity trend |
| `GET` | `/api/users/analytics/table-statistics` | `users:view` | Full tabular stats |
| `GET` | `/api/users/analytics/table-report` | `users:view` | Extended table report |
| `GET` | `/api/users/analytics/user-report/:userId` | `users:view` | Per-user analytics report |
| `GET` | `/api/users/analytics/activity-summary/:userId` | `users:view` | Per-user activity summary |
| `GET` | `/api/users/analytics/users-with-analytics` | `users:view` | User list enriched with computed analytics |
| `GET` | `/api/users/analytics/user-engagement` | `users:view` | Engagement metrics |
| `GET` | `/api/users/analytics/all-stats` | `users:view` | All stat groups in one response — query: `trendDays` (1–365), `interestLimit` (1–100), `topUsersLimit` (1–50) |

---

### Export / Import

All export/import routes enforce an additional lower rate limit.

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/users/export/data` | `users:export` | Export full user data as JSON attachment |
| `GET` | `/api/users/export/statistics` | `users:export` | Export aggregated statistics as JSON attachment |
| `GET` | `/api/users/export/csv` | `users:export` | Export all users as CSV attachment |
| `POST` | `/api/users/import/data` | `users:import` | Import/upsert users from JSON array — body: `{ users: [...] }` |
| `POST` | `/api/users/import/csv` | `users:import` | Import/upsert users from CSV text — body: `{ csv: "..." }` |

---

## Available Scripts

| Script | Description |
|---|---|
| `npm start` | Start server with `node` |
| `npm run start:prod` | Start with `NODE_ENV=production` |
| `npm run dev` | Start with `nodemon` (hot reload) |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with auto-fix |
| `npm test` | Run tests (inline, force exit) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run test:ci` | Run tests with coverage + JUnit reporter (for CI) |

---

## Testing

```bash
# Run all tests
npm test

# With coverage
npm run test:coverage
```

Coverage thresholds are enforced at 60% for branches, functions, lines, and statements.

Test reports and coverage are output to `coverage/`.

---

## Docker

### Build the image

```bash
docker build -t user-service .
```

The Dockerfile uses a three-stage multi-stage build:

1. **deps** — install production + dev dependencies
2. **build** — run linter to catch errors before shipping
3. **production** — minimal image with only production deps, non-root user, `dumb-init`

### Full stack with docker compose

```bash
# Start all services (user-service + MongoDB 7 + Redis 7)
docker compose up --build

# Stop and remove containers
docker compose down

# Remove volumes too
docker compose down -v
```

---

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push to `main`/`develop` and on pull requests to `main`:

| Job | Runs when |
|---|---|
| **Lint** | Always |
| **Test** (Node 20 & 22) | After lint |
| **Security audit** | After lint |
| **Docker build** | After test + security |

The test job spins up a `mongo:7` service container automatically. Coverage reports are uploaded as build artifacts (7-day retention).

---

## Logging

Winston is used for structured logging.

- **Development** — pretty-printed console output
- **Production** — JSON format written to rotating log files:
  - `logs/app-YYYY-MM-DD.log` — all levels (14-day retention)
  - `logs/error-YYYY-MM-DD.log` — errors only (30-day retention)

Control verbosity with the `LOG_LEVEL` env var (`error`, `warn`, `info`, `debug`).

---

## Security Features

- **Helmet** — sets secure HTTP response headers
- **CORS** — configurable allowed origins
- **HPP** — HTTP Parameter Pollution protection
- **Rate limiting** — per-IP, Redis-backed (falls back to memory)
- **Request timeout** — 30s hard limit; returns 503 on breach
- **Input sanitization** — custom NoSQL injection prevention (strips `$` operators); XSS-safe HTML escaping
- **NoSQL injection** — custom sanitizer removes MongoDB operators from all inputs
- **JWT validation** — issuer, audience, algorithm all verified
- **bcrypt** — configurable rounds (default 12)
