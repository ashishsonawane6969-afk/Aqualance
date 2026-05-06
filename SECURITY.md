# Aqualance Security Documentation

## OWASP Top 10 2021 Compliance Status

This document tracks Aqualance's alignment with the OWASP Top 10 2021 security risks.

---

## A01:2021 – Broken Access Control ✅ **Mitigated**

### Measures Implemented
- **Role-Based Access Control (RBAC)**: Roles `admin`, `delivery`, `salesman` enforced via `auth(roles)` middleware
- **Resource-Level Access Control**:
  - Delivery personnel can only view their own orders (`orderController.getOne`, `deliveryController.getOrders`)
  - Salesmen can only access leads assigned to them (`salesmanController.getLeads`, `getLead`, `updateLead`)
  - Order status updates restricted to assigned delivery personnel (`orderController.updateStatus`)
- **Token Revocation**: JWT `jti` claim tracked in `token_revocations` table; middleware validates on every authenticated request
- **Password Changed At Check**: Tokens issued before password reset are rejected (`auth.js` lines 72-84)

### Audit Notes
- All authenticated routes verify user role AND resource ownership where applicable
- Admin-only routes protected by `auth(['admin'])` middleware

---

## A02:2021 – Cryptographic Failures ✅ **Mitigated**

### Measures Implemented
- **Password Hashing**: `@node-rs/bcrypt` (Rust WASM) with 12 rounds (configurable via `BCRYPT_ROUNDS`)
- **JWT Signing**: HS256 algorithm enforced; secrets validated at startup (≥32 chars, not default)
- **MFA Secret Encryption**: AES-256-GCM with `MFA_ENCRYPTION_KEY` (64 hex chars)
- **HTTPS Enforcement**: Cookie `Secure` flag in production; Nginx TLS 1.2/1.3
- **Environment Validation**: `validateEnv.js` checks crypto secrets at startup (fatal in production)

### Configuration
- `JWT_SECRET`: ≥32 chars, unique per environment
- `MFA_ENCRYPTION_KEY`: 64 hex chars
- `MFA_TEMP_SECRET`: Independent from JWT_SECRET

---

## A03:2021 – Injection ✅ **Mitigated**

### Measures Implemented
- **SQL Injection**: All database queries use parameterized statements via `mysql2/promise`
- **No Dynamic SQL**: Column names derived from schema introspection, not user input
- **Input Validation**: Joi schemas with `stripUnknown: true` on all endpoints
- **HTML Entity Encoding**: `safeText` validator encodes `<`, `>`, `&`, `"`, `'` in user input
- **XSS Prevention**: Frontend uses `textContent` and DOM creation (not `innerHTML` with unsanitized data)
- **Photo Upload Validation**: Magic byte verification matches declared MIME type (`validatePhoto.js`)

### Code Review Notes
- No `eval()`, `Function()`, or dynamic code execution found
- All outbound requests validated against SSRF allowlist (see A10)

---

## A04:2021 – Insecure Design ⚠️ **Partially Addressed**

### Measures Implemented
- **Rate Limiting**: 6-tier rate limiting via `express-rate-limit`
  - Global: 300 req/15min per IP
  - Auth: 10 attempts/15min per IP
  - Public writes: 20 orders/hour per IP
  - AI chat: 6-layer protection (burst, hourly, daily, token budget, interval, prompt injection)
- **Account Lockout**: 10 failed attempts → 30-minute lockout
- **GPS Verification**: Geo endpoints validate coordinates within assigned taluka radius
- **India Bounding Box**: Blocks GPS spoofing from outside India (lat 6.5-37.5, lng 68.0-97.5)

### Design Considerations
- Guest order creation is intentionally public (business requirement)
- Consider mandatory MFA for admin accounts (✅ now enforced as of latest update)

---

## A05:2021 – Security Misconfiguration ✅ **Mitigated**

### Measures Implemented
- **Helmet.js**: Full security headers (CSP, HSTS, NoSniff, Frameguard, XSS filter)
- **CORS**: Whitelist via `ALLOWED_ORIGINS` env var; rejects `*` in production
- **Nginx Hardening**: TLS 1.2/1.3, strong cipher suite, security headers
- **Environment Validation**: Startup checks for misconfigured secrets
- **No Default Credentials**: First admin must be created manually or via migration
- **Cookie Security**: `httpOnly`, `Secure`, `SameSite=None` (prod) / `Lax` (dev)

### Configuration Files
- `nginx.conf`: TLS, headers, gzip settings
- `backend/.env.example`: Template with security notes
- `frontend/.env`: No secrets stored

---

## A06:2021 – Vulnerable and Outdated Components ✅ **Mitigated**

### Measures Implemented
- **Dependency Scanning**: `npm audit` shows 0 vulnerabilities (as of latest scan)
- **Express 4.x**: Legacy but actively maintained with security patches
- **Bcrypt**: Switched fully to `@node-rs/bcrypt` (no `bcryptjs` fallback)
- **No Known CVEs**: All dependencies at latest compatible versions

### Maintenance
- Run `npm audit` regularly (automate via CI/CD — see Phase 4)
- Monitor `express` 5.x release for migration planning

---

## A07:2021 – Identification and Authentication Failures ✅ **Mitigated**

### Measures Implemented
- **Password Complexity**: Minimum 8 chars, uppercase, lowercase, number (Joi `passwordComplex` pattern)
- **MFA Enforcement**: Admin accounts REQUIRE MFA (TOTP via Google Authenticator)
- **JWT Security**: 7-day expiry, `jti` for revocation, `password_changed_at` invalidation
- **Session Management**: httpOnly cookie storage, mobile Bearer token fallback
- **Account Lockout**: 10 failed attempts → 30-minute lockout with logging
- **Timing-Safe Comparison**: Dummy hash for non-existent users prevents enumeration

### Authentication Flow
1. Login → Validate credentials → Check MFA status
2. MFA enabled → Issue temporary token (5min) → Verify OTP → Full JWT
3. MFA not set up → Return `mfa_setup_required: true`
4. Successful login → JWT in httpOnly cookie + session profile in response

---

## A08:2021 – Software and Data Integrity Failures ✅ **Mitigated**

### Measures Implemented
- **File Upload Validation**: Magic byte verification for lead photos (`validatePhoto.js`)
  - Allowed types: JPEG, PNG, WebP, GIF
  - Max size: 3.75MB (5M base64 chars)
  - Declared MIME must match actual file signature
- **Dependency Integrity**: `package-lock.json` committed to repo
- **No Insecure Deserialization**: No `eval()`, `JSON.parse()` only on trusted data
- **GitHub Export**: SQL dump excludes sensitive tables (`users`, `token_revocations`, `otp_pending`)

### Protects Against
- Malicious file uploads (webshells, malware)
- MIME confusion attacks (declared JPEG but actual JavaScript)

---

## A09:2021 – Security Logging and Monitoring Failures ✅ **Mitigated**

### Measures Implemented
- **Winston Logger**: Structured JSON logs with rotation (14-30 days, 20MB max)
  - Error log: `/var/log/aqualence/error-YYYY-MM-DD.log`
  - Combined log: `/var/log/aqualence/app-YYYY-MM-DD.log`
- **Security Alerts**: `securityAlerts.js` fires on:
  - `ACCOUNT_LOCKED` (critical)
  - `MULTIPLE_FAILED_LOGIN` (warning)
  - `MFA_VERIFY_FAIL` (warning)
  - `INACTIVE_LOGIN_ATTEMPT` (warning)
  - `ADMIN_LOGIN` (info, audit trail)
  - `MFA_DISABLED` (warning)
  - `RATE_LIMIT_HIT` (warning)
  - `ACCESS_DENIED` (warning, new)
- **Webhook Integration**: Optional `ALERT_WEBHOOK_URL` for Slack/Discord alerts
- **Access Denied Logging**: 403 responses logged with user ID, role, required roles, IP, path

---

## A10:2021 – Server-Side Request Forgery (SSRF) ✅ **Mitigated**

### Measures Implemented
- **SSRF Guard Utility**: `utils/ssrfGuard.js` validates all outbound requests
  - Allowlist: `api.github.com`, `www.fast2sms.com`, `*.googleapis.com`
  - Blocks private IPs (RFC 1918, loopback, link-local, cloud metadata)
  - Only HTTPS allowed (except localhost in dev)
- **Applied To**:
  - GitHub export (`routes/export.js`)
  - Security webhook alerts (`utils/securityAlerts.js`)

### Blocks
- Internal network scanning via `169.254.169.254` (cloud metadata)
- Private IP ranges: `10.x`, `172.16-31.x`, `192.168.x`, `127.x`
- Unauthorized external destinations

---

## Security Contacts & Reporting

**To report a security vulnerability:**
1. **DO NOT** open a public GitHub issue
2. Email: security@aqualance.com (configure this address)
3. Or use the security webhook: Set `ALERT_WEBHOOK_URL` in `.env`

**Response Timeline:**
- Acknowledgment: Within 48 hours
- Initial assessment: Within 7 days
- Fix deployment: Based on severity (critical: 24-48 hours)

---

## Environment Variables (Security-Sensitive)

| Variable | Purpose | Requirement |
|----------|---------|-------------|
| `JWT_SECRET` | JWT signing key | ≥32 chars, unique per env |
| `MFA_ENCRYPTION_KEY` | MFA secret encryption | 64 hex chars |
| `MFA_TEMP_SECRET` | MFA temp tokens | Independent from JWT_SECRET |
| `GITHUB_TOKEN` | SQL export to GitHub | Dedicated token, minimal scopes |
| `ALERT_WEBHOOK_URL` | Security alerts | HTTPS URL (validated by SSRF guard) |
| `FAST2SMS_API_KEY` | SMS OTP delivery | Keep secret, rotate regularly |
| `GEMINI_API_KEY` | AI chat backend | Restrict to server IP in Google Cloud Console |

---

## Deployment Security Checklist

- [ ] `NODE_ENV=production` set
- [ ] All secrets in environment variables (no hardcoded values)
- [ ] `ALLOWED_ORIGINS` configured (no `*` in production)
- [ ] `JWT_SECRET` ≥32 chars, not default value
- [ ] `MFA_ENCRYPTION_KEY` is 64 hex chars
- [ ] SSL/TLS certificates valid (Nginx)
- [ ] Security webhook configured (`ALERT_WEBHOOK_URL`)
- [ ] Admin forced to set up MFA on first login
- [ ] `backend/.env` not tracked by git (verify `.gitignore`)
- [ ] Run `npm audit` before deployment

---

*Last updated: 2026-05-06*
