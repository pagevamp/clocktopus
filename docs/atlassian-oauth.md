# Atlassian OAuth 2.0 Setup

Clocktopus uses Atlassian OAuth 2.0 (3LO) so users can connect their Jira account with a single click instead of manually copying API tokens.

## Prerequisites

- A Clocktopus dashboard running on `http://localhost:4001`
- An Atlassian account with admin access to create OAuth apps

## Step 1: Create an Atlassian OAuth App

1. Go to [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/)
2. Click **Create** and select **OAuth 2.0 integration**
3. Give it a name (e.g. "Clocktopus") and agree to the terms

## Step 2: Configure Authorization

1. In your app, go to **Authorization** in the left sidebar
2. Next to **OAuth 2.0 (3LO)**, click **Configure**
3. Set the **Callback URL** to:
   ```
   http://localhost:4001/api/jira/callback
   ```
4. Click **Save changes**

## Step 3: Add Permissions (Scopes)

1. Go to **Permissions** in the left sidebar
2. Under **Jira API**, click **Configure** and add:
   - `read:jira-work` -- Read issues, worklogs, and projects
   - `write:jira-work` -- Create worklogs when stopping timers
   - `read:jira-user` -- Read user profile for status checks
3. Under **User identity API**, click **Configure** and add:
   - `read:me` -- Read your Atlassian profile

The `offline_access` scope (for refresh tokens) is requested automatically by Clocktopus and does not need to be configured in the console.

## Step 4: Get Client Credentials

1. Go to **Settings** in the left sidebar
2. Copy the **Client ID** and **Client Secret**
3. Add them to your `.env` file:
   ```
   ATLASSIAN_CLIENT_ID="your_client_id_here"
   ATLASSIAN_CLIENT_SECRET="your_client_secret_here"
   ```

## Step 5: Connect

1. Start the dashboard: `bun run build && bun run dashboard`
2. Open `http://localhost:4001`
3. Go to the **Settings** tab
4. Click **Connect Atlassian**
5. You'll be redirected to Atlassian to authorize the app
6. After authorizing, you'll be redirected back to the dashboard with a success message

## How It Works

- On first connect, Clocktopus exchanges the authorization code for an **access token** and **refresh token**
- The access token expires after ~1 hour; Clocktopus automatically refreshes it using the refresh token
- Tokens are stored locally in the SQLite database (`data/db/sessions.db`)
- The **cloud ID** is fetched automatically from Atlassian's accessible-resources API to construct the correct API URL

## Fallback: API Token

If you prefer not to set up an OAuth app, you can still use a manual API token:

1. Go to [Atlassian API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Create a new token
3. In the dashboard Settings tab, click "or use API token" and enter:
   - **Atlassian URL**: `https://your-org.atlassian.net/rest/api/3`
   - **Email**: your Atlassian account email
   - **API Token**: the token you just created

## Troubleshooting

### "Unauthorized; scope does not match"

The scopes configured in the Atlassian Developer Console don't match what Clocktopus requests. Make sure you've added all four scopes listed in Step 3, then click **Connect Atlassian** again to re-authorize with the updated scopes.

### "No accessible resources"

Your Atlassian account doesn't have access to any Jira sites. Make sure you're logging in with an account that has access to at least one Jira Cloud site.

### Token refresh fails

If the refresh token becomes invalid (e.g. app permissions changed), click **Connect Atlassian** again to re-authorize.
