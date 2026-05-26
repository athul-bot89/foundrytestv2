# Embedding the Chat App in SharePoint

This guide explains how to embed the React Chat App in a SharePoint site and pass the user's bearer token from SharePoint to the app.

## Architecture

```
┌─────────────────────────────────────────────┐
│  SharePoint Page                            │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ SPFx Web Part (ChatAppEmbed)        │    │
│  │                                     │    │
│  │  1. Acquires bearer token via       │    │
│  │     AadTokenProvider                │    │
│  │                                     │    │
│  │  2. Renders <iframe> pointing to    │    │
│  │     hosted React app                │    │
│  │                                     │    │
│  │  3. Posts token via postMessage     │    │
│  │     ┌───────────────────────┐       │    │
│  │     │ React App (iframe)    │       │    │
│  │     │                       │       │    │
│  │     │ TokenInfo.js listens  │       │    │
│  │     │ for AUTH_TOKEN msg    │       │    │
│  │     │ and displays token    │       │    │
│  │     └───────────────────────┘       │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

## Prerequisites

1. **Node.js 18.x** (LTS) — required for SPFx development
2. **Azure AD App Registration** for your backend API that exposes a scope (e.g., `api://<app-id>/access_as_user`)
3. **SharePoint Online tenant** — `https://botangelos.sharepoint.com`
4. **HTTPS hosting** for the React app (e.g., Azure Static Web Apps)

---

## Step 1: Build & Host the React App

```bash
cd chat-app
npm install
npm run build
```

Deploy the `build/` folder to an HTTPS host. Options:
- **Azure Static Web Apps** (recommended, free tier): `az staticwebapp create ...`
- **Azure Blob Storage + CDN**
- **Any HTTPS web server**

Note the hosted URL (e.g., `https://your-app.azurestaticapps.net`).

---

## Step 2: Register Your Backend API in Azure AD

If not already done:

1. Go to [Azure Portal → App registrations](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click **New registration**
3. Name: `Chat App Backend API`
4. Under **Expose an API**:
   - Set Application ID URI: `api://<your-app-id>`
   - Add a scope: `access_as_user` (admin + user consent)
5. Note the **Application ID URI** — you'll use this in the SPFx web part config.

---

## Step 3: Configure & Deploy the SPFx Web Part

### 3a. Update Configuration

Edit `spfx-webpart/config/package-solution.json`:
- Replace `"YOUR-BACKEND-API-APP-NAME"` with your Azure AD app's display name
- Replace the `scope` if different from `access_as_user`

### 3b. Install Dependencies & Build

```bash
cd spfx-webpart
npm install

# For development (local workbench)
npm run serve

# For production
npm run bundle
npm run package
```

This produces `sharepoint/solution/chat-app-embed.sppkg`.

### 3c. Deploy to SharePoint App Catalog

1. Go to `https://botangelos.sharepoint.com/sites/appcatalog`
2. Upload `chat-app-embed.sppkg` to the **Apps for SharePoint** library
3. Click **Deploy** when prompted

### 3d. Approve API Permissions

1. Go to **SharePoint Admin Center** → **Advanced** → **API access**
   (`https://botangelos-admin.sharepoint.com/_layouts/15/online/AdminHome.aspx#/webApiPermissionManagement`)
2. Find the pending permission request for your backend API
3. Click **Approve**

---

## Step 4: Add the Web Part to a Page

1. Go to any modern SharePoint page
2. Click **Edit** → **+** (Add web part)
3. Search for **"Chat App Embed"**
4. Add it to the page
5. Click the web part's **edit pencil** icon to configure:
   - **React App URL**: The HTTPS URL where your React app is hosted
   - **API Resource URI**: Your backend API's Application ID URI (e.g., `api://xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
6. **Publish** the page

---

## How It Works

1. The SPFx web part renders on the SharePoint page
2. It creates an `<iframe>` pointing to your hosted React app
3. When the iframe loads, the web part acquires a bearer token from Azure AD using `AadTokenProvider.getToken(apiResourceUri)`
4. It posts the token to the iframe via `window.postMessage`:
   ```js
   iframe.contentWindow.postMessage({
     type: 'AUTH_TOKEN',
     token: 'eyJ0eXAi...',
     user: { name: 'John Doe', email: 'john@botangelos.com' }
   }, targetOrigin);
   ```
5. The React app's `TokenInfo.js` component listens for this message, validates the origin (`https://botangelos.sharepoint.com`), and displays the token

---

## Security Notes

- The React app **only accepts** `postMessage` from `https://botangelos.sharepoint.com` (configured in `ALLOWED_ORIGINS`)
- The SPFx web part posts messages **only to the iframe's origin** (not `*`)
- The token is scoped to your specific backend API — it cannot access other resources
- SharePoint admin must explicitly approve API permissions before tokens can be acquired

---

## Local Testing (Without SharePoint)

To test the React app's token display locally, create a test HTML file:

```html
<!-- test-embed.html — open in browser -->
<!DOCTYPE html>
<html>
<body>
  <h2>SharePoint Simulation</h2>
  <iframe id="app" src="http://localhost:3000" style="width:100%;height:700px;border:1px solid #ccc;"></iframe>
  <script>
    const iframe = document.getElementById('app');
    iframe.addEventListener('load', () => {
      // Simulate SharePoint posting a token
      iframe.contentWindow.postMessage({
        type: 'AUTH_TOKEN',
        token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.FAKE_TOKEN_FOR_TESTING_PURPOSES_ONLY.signature',
        user: { name: 'Test User', email: 'test@botangelos.com' }
      }, 'http://localhost:3000');
    });
  </script>
</body>
</html>
```

> **Note**: For local testing, temporarily add `http://localhost:3000` to `ALLOWED_ORIGINS` in `TokenInfo.js`. Remove it before production deployment.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Waiting for token from SharePoint..." never resolves | Check browser console for postMessage errors. Verify `ALLOWED_ORIGINS` matches the SharePoint URL. |
| Token acquisition fails in SPFx | Ensure API permissions are approved in SharePoint admin center. Check the API Resource URI is correct. |
| iframe blocked / X-Frame-Options | Ensure your React app hosting does NOT set `X-Frame-Options: DENY` or restrictive CSP `frame-ancestors`. |
| CORS errors from chat API | The chat API backend must allow requests from the hosted React app origin. |
