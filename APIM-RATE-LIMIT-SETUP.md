# APIM Rate Limit Setup (Token-Based)

## Overview

This sets up per-token rate limiting on Azure API Management using internal cache. Each unique Bearer token is limited to a configurable number of requests per time window. Exceeding the limit returns `429 Too Many Requests`.

> **Note:** The built-in `rate-limit-by-key` policy does NOT reliably enforce blocking on BasicV2/StandardV2 tiers due to distributed counters. This approach uses `cache-lookup-value` + `choose` + `return-response` which works reliably.

---

## Prerequisites

- Azure CLI logged in (`az login`)
- APIM service deployed
- API already configured with wildcard operations (`/*`) for all HTTP methods (GET, POST, PUT, PATCH, DELETE)

---

## Step 1: Add Wildcard Operations (if not already present)

Replace the variables:
- `SUBSCRIPTION_ID` — your Azure subscription ID
- `RESOURCE_GROUP` — resource group containing the APIM
- `APIM_NAME` — your APIM service name
- `API_ID` — the API identifier in APIM

```bash
SUBSCRIPTION_ID="your-subscription-id"
RESOURCE_GROUP="your-resource-group"
APIM_NAME="your-apim-name"
API_ID="your-api-id"

for METHOD in GET POST PUT PATCH DELETE; do
  az rest --method put \
    --url "https://management.azure.com/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.ApiManagement/service/${APIM_NAME}/apis/${API_ID}/operations/$(echo $METHOD | tr '[:upper:]' '[:lower:]')-all?api-version=2022-08-01" \
    --body "{\"properties\":{\"displayName\":\"${METHOD} Catch All\",\"method\":\"${METHOD}\",\"urlTemplate\":\"/*\"}}" \
    -o none
done
```

---

## Step 2: Apply the Rate Limit Policy

Create a policy file. Adjust `calls` (max requests) and `duration` (window in seconds) as needed:

```bash
# Configuration
MAX_CALLS=1          # Max requests per token per window
WINDOW_SECONDS=60    # Time window in seconds
```

```bash
cat > /tmp/apim-rate-limit-policy.json << ENDOFFILE
{
  "properties": {
    "format": "xml",
    "value": "<policies><inbound><base /><cache-lookup-value key=\"@(&quot;rate-&quot; + context.Request.Headers.GetValueOrDefault(&quot;Authorization&quot;,&quot;anonymous&quot;).GetHashCode().ToString())\" variable-name=\"callCount\" default-value=\"0\" /><set-variable name=\"currentCount\" value=\"@(int.Parse((string)context.Variables[&quot;callCount&quot;]) + 1)\" /><cache-store-value key=\"@(&quot;rate-&quot; + context.Request.Headers.GetValueOrDefault(&quot;Authorization&quot;,&quot;anonymous&quot;).GetHashCode().ToString())\" value=\"@(((int)context.Variables[&quot;currentCount&quot;]).ToString())\" duration=\"${WINDOW_SECONDS}\" /><choose><when condition=\"@((int)context.Variables[&quot;currentCount&quot;] > ${MAX_CALLS})\"><return-response><set-status code=\"429\" reason=\"Too Many Requests\" /><set-header name=\"Content-Type\" exists-action=\"override\"><value>application/json</value></set-header><set-header name=\"Retry-After\" exists-action=\"override\"><value>${WINDOW_SECONDS}</value></set-header><set-body>{\"error\": \"Rate limit exceeded. Maximum ${MAX_CALLS} request(s) per ${WINDOW_SECONDS} seconds per token.\"}</set-body></return-response></when></choose></inbound><backend><base /></backend><outbound><base /></outbound><on-error><base /></on-error></policies>"
  }
}
ENDOFFILE
```

Apply it:

```bash
az rest --method put \
  --url "https://management.azure.com/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.ApiManagement/service/${APIM_NAME}/apis/${API_ID}/policies/policy?api-version=2022-08-01" \
  --headers "Content-Type=application/json" \
  --body @/tmp/apim-rate-limit-policy.json
```

---

## Step 3: Remove Any Conflicting Operation-Level Policies

If operations have their own rate-limit policies, remove them so only the API-level policy applies:

```bash
for OP in post-all get-all put-all patch-all delete-all; do
  az rest --method delete \
    --url "https://management.azure.com/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.ApiManagement/service/${APIM_NAME}/apis/${API_ID}/operations/${OP}/policies/policy?api-version=2022-08-01" \
    -o none 2>/dev/null
done
```

---

## Step 4: Verify

```bash
# First request — should pass through (or 401 if token invalid)
curl -s -D - "https://${APIM_NAME}.azure-api.net/<api-path>/test" \
  -H "Authorization: Bearer your-token"

# Second request within window — should return 429
curl -s -D - "https://${APIM_NAME}.azure-api.net/<api-path>/test" \
  -H "Authorization: Bearer your-token"
```

Expected second response:
```
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json

{"error": "Rate limit exceeded. Maximum 1 request(s) per 60 seconds per token."}
```

---

## How It Works

1. **`cache-lookup-value`** — Reads the current call count for this token's hash from APIM internal cache
2. **`set-variable`** — Increments the counter
3. **`cache-store-value`** — Stores the new count with a TTL equal to the time window (auto-resets)
4. **`choose` + `return-response`** — If count exceeds limit, immediately returns 429 without hitting the backend

---

## Production Recommendations

| Setting | Testing | Production |
|---------|---------|------------|
| `MAX_CALLS` | 1 | 20–100 (based on expected usage) |
| `WINDOW_SECONDS` | 60 | 60 |

- Different tokens get independent counters (users don't affect each other)
- Counter resets automatically after the window expires (cache TTL)
- No subscription key required on the API
- Works on BasicV2, StandardV2, and Consumption tiers
