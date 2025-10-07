# Cluster Registration Startup Flow

This document demonstrates the new startup behavior where monitoring only begins after successful cluster registration.

## Configuration Options

The behavior is controlled by these environment variables:

- `CLUSTER_NAME`: Required for registration (e.g., "prod-cluster")
- `USER_EMAIL`: Required for registration (e.g., "devops@company.com") 
- `SKIP_CLUSTER_REGISTRATION`: Set to "true" to disable registration requirement
- `OPSCTRL_BACKEND_URL`: Backend URL (defaults to "https://api.opsctrl.io")

## Startup Flow Examples

### 1. Successful Registration (Normal Flow)

```bash
🚀 Starting opsctrl-daemon...
📦 Version: 1.0.0
🌍 Environment: production
🔗 Cluster registration is required before starting monitoring...
⏳ Waiting for cluster registration to complete...
🔄 Registering cluster with backend: https://api.opsctrl.dev
   Cluster ID: clu_abc123def456
   Cluster Name: prod-cluster
   User Email: devops@company.com
✅ Cluster registered successfully!
   Cluster ID: clu_abc123def456

🌐 Complete your cluster registration in the browser:
   https://dashboard.opsctrl.io/clusters/clu_abc123def456/complete
   (Optional: Visit the link above to access your cluster dashboard)
🎯 Cluster registered successfully: clu_abc123def456
🚀 Initializing monitoring system...
✅ Monitoring started for 3 namespaces
🔄 opsctrl-daemon is running. Press Ctrl+C to stop.
```

### 1a. Registration with Pending Confirmation (Production Mode)

```bash
🚀 Starting opsctrl-daemon...
📦 Version: 1.0.0
🌍 Environment: production
🔗 Cluster registration is required before starting monitoring...
⏳ Waiting for cluster registration to complete...
🔄 Registering cluster with backend: https://api.opsctrl.io
   Cluster ID: clu_abc123def456
   Cluster Name: prod-cluster
   User Email: devops@company.com
📧 Cluster pre-registered successfully! Awaiting backend confirmation.
   Cluster ID: clu_abc123def456

🌐 Complete your cluster registration:
   https://dashboard.opsctrl.io/clusters/clu_abc123def456/complete

⚠️  Registration confirmation required - please check your email or visit the link above.
   The daemon will automatically detect when registration is confirmed.

 ❌ Error: Cluster registration initiated. Please check your email or visit the registration URL to complete the process.
```

### 1b. Pending Registration Detected on Restart (Confirmed)

```bash
🚀 Starting opsctrl-daemon...
📦 Version: 1.0.0
🌍 Environment: production
🔗 Cluster registration is required before starting monitoring...
⏳ Waiting for cluster registration to complete...
🔄 Found pending cluster registration: clu_abc123def456
   Registration URL: https://dashboard.opsctrl.io/clusters/clu_abc123def456/complete
✅ Cluster registration confirmed by backend!
   Cluster ID: clu_abc123def456
🎯 Cluster registered successfully: clu_abc123def456
🚀 Initializing monitoring system...
✅ Monitoring started for 3 namespaces
🔄 opsctrl-daemon is running. Press Ctrl+C to stop.
```

### 1c. Pending Registration Still Not Confirmed

```bash
🚀 Starting opsctrl-daemon...
📦 Version: 1.0.0
🌍 Environment: production
🔗 Cluster registration is required before starting monitoring...
⏳ Waiting for cluster registration to complete...
🔄 Found pending cluster registration: clu_abc123def456
   Registration URL: https://dashboard.opsctrl.io/clusters/clu_abc123def456/complete
⏳ Registration still pending. Please complete registration:
   https://dashboard.opsctrl.io/clusters/clu_abc123def456/complete
   📧 Check your email for registration confirmation.

 ❌ Error: Cluster registration is pending completion. Please check your email or visit the registration URL.
```

### 2. Registration with Retries

```bash
🚀 Starting opsctrl-daemon...
📦 Version: 1.0.0
🌍 Environment: production
🔗 Cluster registration is required before starting monitoring...
⏳ Waiting for cluster registration to complete...
🔄 Registration attempt failed: HTTP 503: Service Unavailable. Retrying...
🔄 Registration attempt failed: Network Error. Retrying...
🔄 Registering cluster with backend: https://api.opsctrl.io
   Cluster ID: clu_abc123def456
   Cluster Name: prod-cluster
   User Email: devops@company.com
✅ Cluster registered successfully!
   Cluster ID: clu_abc123def456
🎯 Cluster registered successfully: clu_abc123def456
🚀 Initializing monitoring system...
✅ Monitoring started for 3 namespaces
🔄 opsctrl-daemon is running. Press Ctrl+C to stop.
```

### 3. Registration Timeout (Failure)

```bash
🚀 Starting opsctrl-daemon...
📦 Version: 1.0.0
🌍 Environment: production
🔗 Cluster registration is required before starting monitoring...
⏳ Waiting for cluster registration to complete...
🔄 Registration attempt failed: Network Error. Retrying...
🔄 Registration attempt failed: HTTP 503: Service Unavailable. Retrying...
🔄 Registration attempt failed: Timeout. Retrying...
[continues for 5 minutes...]

 ❌ Error: Failed to register cluster within timeout period. Cannot proceed with monitoring.
```

### 4. Registration Disabled

```bash
🚀 Starting opsctrl-daemon...
📦 Version: 1.0.0
🌍 Environment: production
ℹ️  Cluster registration disabled (SKIP_CLUSTER_REGISTRATION=true)
🚀 Initializing monitoring system...
✅ Monitoring started for 3 namespaces
🔄 opsctrl-daemon is running. Press Ctrl+C to stop.
```

### 5. Missing Configuration

```bash
🚀 Starting opsctrl-daemon...
📦 Version: 1.0.0
🌍 Environment: production
ℹ️  Cluster registration skipped (CLUSTER_NAME or USER_EMAIL not provided)
🚀 Initializing monitoring system...
✅ Monitoring started for 3 namespaces
🔄 opsctrl-daemon is running. Press Ctrl+C to stop.
```

## Key Features

1. **Retry Logic**: Uses `waitUntil` utility with exponential backoff
2. **Timeout Protection**: 5-minute timeout prevents infinite waiting
3. **Graceful Fallback**: Can be disabled via `SKIP_CLUSTER_REGISTRATION`
4. **Clear Logging**: Each step is clearly logged for debugging
5. **Fail-Fast**: Hard exit if registration fails and is required
6. **Pending Registration Management**: Automatically saves and tracks incomplete registrations
7. **Backend Verification**: Periodically checks with backend for registration confirmation
8. **Production-Ready**: No browser opening attempts in containerized environments
9. **Persistent State**: Registration state survives daemon restarts

## Technical Details

- **Retry Interval**: 10 seconds between registration attempts
- **Total Timeout**: 5 minutes (300 seconds) maximum wait time
- **Failure Handling**: Logs each failed attempt with reason
- **Environment Integration**: Sets `CLUSTER_ID` env var for watchdog use
- **State Files**:
  - `~/.opsctrl/cluster.json`: Completed registration information
  - `~/.opsctrl/pending.json`: Pending registration state
- **Backend Verification**: GET `/api/clusters/{cluster_id}/status` endpoint
- **Status Values**: `pending`, `active`, `confirmed` (active/confirmed = complete)

This ensures that clusters are properly registered and identified before any monitoring or diagnosis begins, with robust state management for production environments where browser interaction is not possible.