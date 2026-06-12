# API Reference

All endpoints are prefixed with `/api/v1`. The API is documented interactively at `/api/docs` (Swagger UI) and `/api/redoc` (ReDoc).

**Authentication**: All protected endpoints require `Authorization: Bearer <token>` in the request header. Tokens are obtained via the sign-in endpoint.

---

## Table of Contents

- [Health](#health)
- [Authentication](#authentication)
- [Contracts](#contracts)
- [Teams & Accounts](#teams--accounts)
- [Question Categories](#question-categories)
- [Credits](#credits)
- [Vouchers](#vouchers)
- [Questions](#questions)
- [Audit Logs](#audit-logs)
- [Support](#support)
- [Beta](#beta)
- [Tasks](#tasks)
- [WebSocket — Job Status](#websocket--job-status)

---

## Health

### `GET /health`

Returns server health status. Does not require authentication.

**Response** `200 OK`
```json
{ "status": "healthy" }
```

---

## Authentication

Authentication endpoints are defined within the contract routes. Standard flow:

### `POST /api/v1/auth/signup`

Register a new user account.

**Request Body**
```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "name": "Jane Doe"
}
```

**Response** `201 Created`
```json
{
  "id": "user_id",
  "email": "user@example.com",
  "name": "Jane Doe"
}
```

---

### `POST /api/v1/auth/login`

Authenticate and receive a JWT access token.

**Request Body**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response** `200 OK`
```json
{
  "access_token": "<jwt>",
  "token_type": "bearer"
}
```

---

## Contracts

### `POST /api/v1/contracts/upload`

Upload a PDF contract and trigger the processing pipeline.

**Auth Required**: Yes  
**Content-Type**: `multipart/form-data`

**Form Fields**

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | `File` | Yes | PDF file (max 100 MB) |
| `questions` | `string` (JSON array) | No | List of questions to answer |
| `categories` | `string` (JSON array) | No | Question category definitions |
| `ai_provider` | `string` | No | `"anthropic"` \| `"gemini"` \| `"openai"` \| `"groq"` |
| `use_local_marker` | `boolean` | No | Use local Marker instead of API (default: `false`) |

**Response** `202 Accepted`
```json
{
  "contract_id": "6650f2ac...",
  "job_id": "uuid-...",
  "message": "Contract uploaded. Processing started."
}
```

---

### `GET /api/v1/contracts`

List all contracts for the authenticated user.

**Auth Required**: Yes

**Query Params**

| Param | Type | Description |
|---|---|---|
| `page` | `int` | Page number (default: 1) |
| `limit` | `int` | Results per page (default: 20) |
| `status` | `string` | Filter by contract status |

**Response** `200 OK`
```json
{
  "contracts": [ { ...contract }, ... ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

---

### `GET /api/v1/contracts/{contract_id}`

Fetch a single contract with its full analysis results.

**Auth Required**: Yes

**Response** `200 OK`
```json
{
  "_id": "6650f2ac...",
  "name": "ServiceAgreement.pdf",
  "status": "Ready to Edit",
  "index": {
    "status": "success",
    "content": "## Contract\n...",
    "html_content": "<h2>Contract</h2>..."
  },
  "summarize": {
    "status": "success",
    "summary": "## Executive Summary\n..."
  },
  "process": {
    "status": "success",
    "results": [
      {
        "version": 1,
        "createdAt": "2024-01-01T00:00:00Z",
        "results": [
          {
            "question": "What is the contract duration?",
            "answer": "The contract runs for 2 years...",
            "confidence": 0.95,
            "source_chunks": ["..."]
          }
        ]
      }
    ]
  },
  "created_at": "2024-01-01T00:00:00Z"
}
```

---

### `DELETE /api/v1/contracts/{contract_id}`

Delete a contract and all its associated data (GridFS file, Vector embeddings).

**Auth Required**: Yes

**Response** `200 OK`
```json
{ "message": "Contract deleted successfully." }
```

---

### `POST /api/v1/contracts/{contract_id}/reprocess`

Re-trigger analysis with new questions or a different AI provider.

**Auth Required**: Yes

**Request Body**
```json
{
  "questions": ["What are the payment terms?"],
  "categories": [],
  "ai_provider": "gemini"
}
```

**Response** `202 Accepted`
```json
{ "job_id": "uuid-...", "message": "Reprocessing started." }
```

---

### `GET /api/v1/contracts/{contract_id}/report`

Retrieve the generated IFRS 15 report for a contract. Triggers generation if not already done.

**Auth Required**: Yes

**Response** `200 OK`
```json
{
  "contract_id": "6650f2ac...",
  "report": {
    "performance_obligations": "...",
    "transaction_price": "...",
    "revenue_recognition": "...",
    "journal_entries": "...",
    "significant_judgments": "..."
  },
  "generated_at": "2024-01-01T00:00:00Z"
}
```

---

## Teams & Accounts

### `POST /api/v1/teams`

Create a new team.

**Auth Required**: Yes

**Request Body**
```json
{
  "name": "Legal Team",
  "description": "Our contract analysis team"
}
```

### `GET /api/v1/teams`

List teams the authenticated user belongs to.

### `POST /api/v1/teams/{team_id}/invite`

Invite a member to a team by email.

**Request Body**
```json
{ "email": "member@company.com", "role": "member" }
```

### `DELETE /api/v1/teams/{team_id}/members/{user_id}`

Remove a member from a team.

---

## Question Categories

### `GET /api/v1/categories`

List all question categories available to the user.

### `POST /api/v1/categories`

Create a new question category.

**Request Body**
```json
{
  "name": "Payment Terms",
  "questions": ["What is the payment frequency?", "What are the late payment penalties?"]
}
```

### `PUT /api/v1/categories/{category_id}`

Update a category.

### `DELETE /api/v1/categories/{category_id}`

Delete a category.

---

## Credits

### `GET /api/v1/credits/balance`

Get the current credit balance for the authenticated user.

**Response** `200 OK`
```json
{ "balance": 150, "used": 50, "total_purchased": 200 }
```

### `POST /api/v1/credits/topup`

Initiate a Stripe payment session to purchase credits.

**Request Body**
```json
{ "credits": 100 }
```

**Response** `200 OK`
```json
{ "checkout_url": "https://checkout.stripe.com/..." }
```

### `GET /api/v1/credits/history`

Get credit usage history.

---

## Vouchers

### `POST /api/v1/vouchers/redeem`

Redeem a voucher code for credits.

**Request Body**
```json
{ "code": "BETA50" }
```

**Response** `200 OK`
```json
{ "credits_added": 50, "new_balance": 200 }
```

---

## Questions

### `POST /api/v1/questions/suggest`

Use AI to suggest relevant questions for a contract.

**Auth Required**: Yes

**Request Body**
```json
{
  "contract_id": "6650f2ac...",
  "context": "Software licensing agreement"
}
```

**Response** `200 OK`
```json
{
  "suggestions": [
    "What is the license duration?",
    "What are the permitted uses?",
    "What are the termination clauses?"
  ]
}
```

---

## Audit Logs

### `GET /api/v1/audit/logs`

Query the audit log for the authenticated user's account.

**Query Params**

| Param | Type | Description |
|---|---|---|
| `from` | `datetime` | Start of date range |
| `to` | `datetime` | End of date range |
| `action` | `string` | Filter by action type |
| `contract_id` | `string` | Filter by contract |

**Response** `200 OK`
```json
{
  "logs": [
    {
      "id": "...",
      "user_id": "...",
      "action": "contract.uploaded",
      "contract_id": "...",
      "timestamp": "2024-01-01T00:00:00Z",
      "details": {}
    }
  ]
}
```

---

## Support

### `POST /api/v1/support/ticket`

Submit a support ticket. Sends an email to the support team.

**Request Body**
```json
{
  "subject": "Issue with contract processing",
  "message": "The processing failed with error...",
  "priority": "high"
}
```

**Response** `200 OK`
```json
{ "ticket_id": "...", "message": "Ticket submitted successfully." }
```

---

## Beta

### `POST /api/v1/beta/apply`

Register as a beta applicant. Triggers an email with a welcome coupon code.

**Request Body**
```json
{
  "email": "user@example.com",
  "name": "Jane Doe",
  "company": "Acme Corp"
}
```

**Response** `200 OK`
```json
{ "message": "Application received. Welcome email sent." }
```

---

## Tasks

### `GET /api/v1/tasks/{job_id}`

Poll the status of a specific background job.

**Auth Required**: Yes

**Response** `200 OK`
```json
{
  "job_id": "uuid-...",
  "job_type": "processing",
  "status": "IN_PROGRESS",
  "current_step": "summarizing",
  "progress": 42.5,
  "error": null,
  "created_at": "...",
  "updated_at": "..."
}
```

**Status Values**: `"IN_PROGRESS"` | `"COMPLETED"` | `"FAILED"`

---

## WebSocket — Job Status

### `WS /api/v1/ws/job-status`

Subscribe to real-time job status updates for contracts belonging to the authenticated user.

**Query Parameters**

| Param | Required | Description |
|---|---|---|
| `token` | Yes | Valid JWT access token |

**Connection URL**
```
ws://<host>/api/v1/ws/job-status?token=<JWT>
```

**Server → Client Messages**

```json
{
  "contract_id": "6650f2ac...",
  "job_type": "processing",
  "status": "IN_PROGRESS",
  "current_step": "summarizing",
  "progress": 42.5,
  "error": null
}
```

**Connection Lifecycle**
1. Client connects with JWT token
2. Server validates the token; closes connection with `4001` if invalid
3. Server sends updates whenever job status changes
4. Server sends final message with `"status": "COMPLETED"` or `"FAILED"`
5. Client should close the connection after receiving a terminal status

**Error Codes**

| Code | Description |
|---|---|
| `4001` | Invalid or expired JWT token |
| `4004` | No active jobs found for user |

---

## Common Error Responses

All error responses follow this shape:

```json
{
  "detail": "Human-readable error message"
}
```

**HTTP Status Codes**

| Code | Meaning |
|---|---|
| `400` | Bad Request — invalid input |
| `401` | Unauthorized — missing or invalid token |
| `403` | Forbidden — insufficient permissions |
| `404` | Not Found — resource does not exist |
| `422` | Unprocessable Entity — validation error |
| `429` | Too Many Requests — rate limit exceeded |
| `500` | Internal Server Error |
