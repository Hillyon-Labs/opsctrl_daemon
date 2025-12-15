# Docker Deployment Guide

This guide covers how to build, run, and deploy the OpsCtrl Daemon using Docker.

## Quick Start

```bash
# Pull and run the official image
docker run -d \
  --name opsctrl-daemon \
  -v ~/.kube/config:/app/.kube/config:ro \
  -e WATCH_NAMESPACES="default,production" \
  -e WEBHOOK_URL="https://hooks.slack.com/services/..." \
  opsctrl/daemon:latest
```

## Building the Docker Image

### Standard Build

```bash
docker build -t opsctrl/daemon:local .
```

### Build with Custom Backend URL

If you're running your own OpsCtrl backend, you can bake in the URL at build time:

```bash
docker build \
  --build-arg OPSCTRL_BACKEND_URL="https://your-backend.example.com" \
  -t opsctrl/daemon:local .
```

> **Note:** The official `opsctrl/daemon` image has the backend URL pre-configured. You only need to specify this if self-hosting.

### Using Build Scripts

```bash
# Build with default tag
./scripts/build-docker.sh

# Build with specific tag
./scripts/build-docker.sh v1.0.0

# Build and push to registry
./scripts/build-docker.sh v1.0.0 push
```

## Running with Docker

### Docker Run

```bash
docker run -d \
  --name opsctrl-daemon \
  --network host \
  -v ~/.kube/config:/app/.kube/config:ro \
  -e WATCH_NAMESPACES="default,production" \
  -e WEBHOOK_URL="https://hooks.slack.com/services/..." \
  -e CLUSTER_NAME="my-cluster" \
  opsctrl/daemon:latest
```

### Docker Compose

```bash
# Start the service
docker-compose up -d

# View logs
docker-compose logs -f opsctrl-daemon

# Stop the service
docker-compose down
```

### Overriding the Backend URL

If using the official image but want to point to a different backend:

```bash
docker run -d \
  --name opsctrl-daemon \
  -v ~/.kube/config:/app/.kube/config:ro \
  -e OPSCTRL_BACKEND_URL="https://your-backend.example.com" \
  -e WATCH_NAMESPACES="default" \
  opsctrl/daemon:latest
```

## Kubernetes Deployment

### Using Helm (Recommended)

```bash
# Add the repository
helm repo add opsctrl https://charts.opsctrl.dev
helm repo update

# Create secret for sensitive values
kubectl create secret generic opsctrl-daemon-secrets \
  --namespace monitoring \
  --from-literal=OPSCTRL_BACKEND_URL="https://api.opsctrl.dev" \
  --from-literal=WEBHOOK_URL="https://hooks.slack.com/services/..."

# Install
helm install opsctrl-daemon opsctrl/opsctrl-daemon \
  --namespace monitoring \
  --create-namespace \
  --set monitoring.watchNamespaces="default,production" \
  --set secrets.existingSecret="opsctrl-daemon-secrets"
```

### Using kubectl

```bash
# Create the secret first
kubectl create secret generic opsctrl-daemon-secrets \
  --from-literal=OPSCTRL_BACKEND_URL="https://api.opsctrl.dev" \
  --from-literal=WEBHOOK_URL="https://hooks.slack.com/services/..."

# Deploy
kubectl apply -f k8s-deployment.yaml

# Check status
kubectl get deployment opsctrl-daemon
kubectl get pods -l app.kubernetes.io/name=opsctrl-daemon
```

### Health Check

```bash
# Port forward to access health endpoint
kubectl port-forward svc/opsctrl-daemon 3000:3000

# Check health
curl http://localhost:3000/health
```

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `WATCH_NAMESPACES` | Comma-separated namespaces to monitor |

### Backend Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `OPSCTRL_BACKEND_URL` | Backend API URL | Built into image |
| `CLUSTER_NAME` | Unique cluster identifier | - |
| `USER_EMAIL` | Email for cluster registration | - |

### Alerting

| Variable | Description | Default |
|----------|-------------|---------|
| `WEBHOOK_URL` | Slack webhook URL | - |
| `ALERT_SEVERITY_FILTERS` | Severity levels to alert on | `medium,high,critical` |
| `ALERT_MAX_ATTEMPTS` | Max retry attempts | `3` |

### Monitoring

| Variable | Description | Default |
|----------|-------------|---------|
| `EXCLUDE_NAMESPACES` | Namespaces to exclude | `kube-system,kube-public,kube-node-lease` |
| `MIN_RESTART_THRESHOLD` | Restarts before alerting | `3` |
| `MAX_PENDING_DURATION_MS` | Max pending time (ms) | `600000` |

### Diagnosis

| Variable | Description | Default |
|----------|-------------|---------|
| `DIAGNOSIS_ENABLED` | Enable diagnosis | `true` |
| `DIAGNOSIS_TIMEOUT_MS` | Diagnosis timeout (ms) | `30000` |
| `DIAGNOSIS_CACHE_TTL_MS` | Cache TTL (ms) | `300000` |

### Health Check

| Variable | Description | Default |
|----------|-------------|---------|
| `ENABLE_HEALTH_CHECK` | Enable HTTP health server | `true` |
| `HEALTH_CHECK_PORT` | Health check port | `3000` |

### Debug

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Log level (error, warn, info, debug) | `info` |
| `DEVELOPMENT_MODE` | Enable dev features | `false` |

## Security

### Non-root User

The container runs as non-root user (UID 1001).

### RBAC Permissions

Minimal read-only permissions:

| Resource | Verbs |
|----------|-------|
| `pods` | get, list, watch |
| `namespaces` | get, list, watch |
| `events` | get, list, watch, create |
| `leases` | get, list, watch, create, update, patch |

### Security Context

- `allowPrivilegeEscalation: false`
- `readOnlyRootFilesystem: true`
- `runAsNonRoot: true`
- All capabilities dropped

### Resource Limits

| Resource | Limit | Request |
|----------|-------|---------|
| Memory | 512Mi | 256Mi |
| CPU | 500m | 100m |

## Health Endpoint

```bash
GET /health
```

Response:

```json
{
  "isHealthy": true,
  "connectionState": {
    "isHealthy": true,
    "lastSuccessfulConnection": "2024-01-01T12:00:00.000Z",
    "consecutiveFailures": 0
  },
  "metrics": {
    "totalFailuresDetected": 42,
    "diagnosisCallsExecuted": 38,
    "reconnectionAttempts": 2
  },
  "activeNamespaces": ["default", "production"],
  "cacheStats": {
    "entries": 15,
    "hitRate": 0.8
  }
}
```

## Troubleshooting

### Check RBAC Permissions

```bash
kubectl auth can-i list pods --as=system:serviceaccount:monitoring:opsctrl-daemon
```

### View Logs

```bash
# Docker
docker logs opsctrl-daemon

# Kubernetes
kubectl logs -l app.kubernetes.io/name=opsctrl-daemon -f
```

### Debug Mode

```bash
docker run -e LOG_LEVEL=debug opsctrl/daemon:latest
```

### Resource Usage

```bash
kubectl top pod -l app.kubernetes.io/name=opsctrl-daemon
```

## Updates

### Rolling Update (Helm)

```bash
helm upgrade opsctrl-daemon opsctrl/opsctrl-daemon --reuse-values
```

### Rolling Update (kubectl)

```bash
kubectl set image deployment/opsctrl-daemon opsctrl-daemon=opsctrl/daemon:v1.1.0
kubectl rollout status deployment/opsctrl-daemon
```

### Rollback

```bash
kubectl rollout undo deployment/opsctrl-daemon
```
