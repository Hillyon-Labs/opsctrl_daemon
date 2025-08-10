# Docker Deployment Guide

This guide covers how to build, run, and deploy the opsctrl-daemon using Docker.

## 🐳 Building the Docker Image

### Quick Build
```bash
# Build with default tag
./scripts/build-docker.sh

# Build with specific tag
./scripts/build-docker.sh v1.0.0

# Build and push to registry
./scripts/build-docker.sh v1.0.0 push
```

### Manual Build
```bash
docker build -t opsctrl-daemon:latest .
```

## 🚀 Running with Docker

### Docker Run (Development)
```bash
docker run -d \
  --name opsctrl-daemon \
  --network host \
  -v ~/.kube/config:/app/.kube/config:ro \
  -e WEBHOOK_URL="https://your-webhook-url" \
  -e WATCH_NAMESPACES="default,production" \
  opsctrl-daemon:latest
```

### Docker Compose (Recommended)
```bash
# Start the service
docker-compose up -d

# View logs
docker-compose logs -f opsctrl-daemon

# Stop the service
docker-compose down
```

## ☸️ Kubernetes Deployment (DaemonSet)

The opsctrl-daemon runs as a DaemonSet to ensure one instance per node for comprehensive cluster monitoring.

### Deploy to Kubernetes
```bash
# Update the webhook URL in the secret
kubectl create secret generic opsctrl-daemon-secrets \
  --from-literal=WEBHOOK_URL="https://your-webhook-url"

# Deploy the DaemonSet
kubectl apply -f k8s-daemonset.yaml

# Check status - should see one pod per node
kubectl get daemonset opsctrl-daemon
kubectl get pods -l app=opsctrl-daemon -o wide

# View logs from all instances
kubectl logs -l app=opsctrl-daemon -f

# View logs from specific node
kubectl logs -l app=opsctrl-daemon -f --field-selector spec.nodeName=your-node-name
```

### Health Check
```bash
# Port forward to access health endpoint (any pod)
kubectl port-forward daemonset/opsctrl-daemon 3000:3000

# Check health
curl http://localhost:3000/health

# Check health of all DaemonSet pods
kubectl get pods -l app=opsctrl-daemon -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.containerStatuses[0].ready}{"\n"}{end}'
```

## 📋 Environment Variables

### Monitoring Configuration
- `WATCH_NAMESPACES` - Comma-separated list of namespaces to monitor
- `EXCLUDE_NAMESPACES` - Comma-separated list of namespaces to exclude
- `MIN_RESTART_THRESHOLD` - Minimum container restarts to trigger alert (default: 3)
- `MAX_PENDING_DURATION_MS` - Max time pod can be pending (default: 600000)

### Alerting Configuration
- `WEBHOOK_URL` - Webhook URL for alerts (required for alerts)
- `ALERT_SEVERITY_FILTERS` - Severity levels to alert on (default: medium,high,critical)
- `ALERT_MAX_ATTEMPTS` - Max retry attempts for failed alerts (default: 3)

### Diagnosis Configuration
- `DIAGNOSIS_ENABLED` - Enable/disable diagnosis (default: true)
- `DIAGNOSIS_TIMEOUT_MS` - Timeout for diagnosis commands (default: 30000)
- `DIAGNOSIS_CACHE_TTL_MS` - Cache TTL for diagnosis results (default: 300000)

### Health Check Configuration
- `ENABLE_HEALTH_CHECK` - Enable HTTP health check server (default: false)
- `HEALTH_CHECK_PORT` - Port for health check server (default: 3000)

## 🔒 Security Considerations

### Non-root User
The container runs as non-root user (UID 1001) for security.

### RBAC Permissions
The Kubernetes DaemonSet includes minimal RBAC permissions:
- `pods`: get, list, watch
- `namespaces`: get, list, watch  
- `events`: get, list, watch, create

### Resource Limits (Per Node)
- Memory: 256Mi limit, 128Mi request
- CPU: 200m limit, 50m request
- Conservative limits since this runs on every node

### Security Context
- `allowPrivilegeEscalation: false`
- `readOnlyRootFilesystem: true`
- `runAsNonRoot: true`
- All capabilities dropped

## 📊 Monitoring

### Health Endpoint
```bash
GET /health
```

Returns:
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

### Logs
View structured logs:
```bash
docker logs opsctrl-daemon
kubectl logs -l app=opsctrl-daemon
```

## 🐛 Troubleshooting

### Common Issues

1. **RBAC Permissions**
   ```bash
   # Check if service account has necessary permissions
   kubectl auth can-i list pods --as=system:serviceaccount:default:opsctrl-daemon
   ```

2. **Network Connectivity**
   ```bash
   # Test Kubernetes API access
   kubectl exec -it deployment/opsctrl-daemon -- wget -q -O- http://kubernetes.default.svc.cluster.local/api/v1
   ```

3. **Resource Limits**
   ```bash
   # Check resource usage
   kubectl top pod -l app=opsctrl-daemon
   ```

### Debug Mode
Run with debug logging:
```bash
docker run -e LOG_LEVEL=debug opsctrl-daemon:latest
```

## 📈 Scaling

### DaemonSet Architecture
The daemon runs as a DaemonSet with one instance per node:
- Ensures comprehensive cluster coverage
- Each pod monitors all namespaces from its node's perspective
- Natural high availability and fault tolerance

### Node Coverage
- Runs on all nodes including master/control-plane nodes
- Uses tolerations to handle node taints
- Automatically scales with cluster size

### Resource Efficiency
- Conservative resource limits (256Mi RAM, 200m CPU per node)
- Efficient caching and connection pooling
- Minimal network overhead with cluster-local API calls

## 🔄 Updates

### Rolling Update
```bash
# Update DaemonSet image
kubectl set image daemonset/opsctrl-daemon opsctrl-daemon=opsctrl-daemon:v1.1.0

# Check rollout status
kubectl rollout status daemonset/opsctrl-daemon

# Monitor the update across all nodes
kubectl get pods -l app=opsctrl-daemon -o wide --watch
```

### Rollback
```bash
# Rollback to previous version
kubectl rollout undo daemonset/opsctrl-daemon

# Check rollback status
kubectl rollout status daemonset/opsctrl-daemon
```