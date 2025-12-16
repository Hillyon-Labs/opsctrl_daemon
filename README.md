# OpsCtrl Daemon

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/docker/v/opsctrl/daemon?label=Docker&sort=semver)](https://hub.docker.com/r/opsctrl/daemon)
[![Helm](https://img.shields.io/badge/Helm-charts.opsctrl.dev-blue)](https://charts.opsctrl.dev)

Kubernetes pod monitoring daemon with automated failure detection, diagnosis, and Slack alerting.

## Overview

OpsCtrl Daemon watches your Kubernetes cluster for pod failures and automatically diagnoses root causes using LLM-powered analysis. When issues occur, it sends detailed alerts with remediation suggestions directly to Slack.

**Key Features:**
- Real-time detection of CrashLoopBackOff, OOMKill, ImagePull failures, and more
- AI-powered root cause analysis with actionable fix suggestions
- Slack integration for instant incident notifications
- Read-only operation - never executes into containers or accesses secrets
- Lightweight single-replica deployment

## Table of Contents

- [Installation](#installation)
  - [Helm (Recommended)](#helm-recommended)
  - [Kubectl](#kubectl)
- [Configuration](#configuration)
- [Usage](#usage)
- [Architecture](#architecture)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Installation

### Prerequisites

- Kubernetes 1.21+
- Helm 3.x
- An OpsCtrl account ([sign up free](https://opsctrl.dev))

### Quick Start (Helm)

```bash
# 1. Add the OpsCtrl Helm repository
helm repo add opsctrl https://charts.opsctrl.dev
helm repo update

# 2. Create the namespace
kubectl create namespace opsctrl


# 3. Install OpsCtrl Daemon
helm install opsctrl-daemon opsctrl/opsctrl-daemon \
  --namespace opsctrl \
  --set clusterRegistration.clusterName="my-cluster" \
  --set clusterRegistration.userEmail="you@example.com" \
  --set monitoring.watchNamespaces="default" \
```

### Verify Installation

```bash
# Check the pod is running
kubectl get pods -n opsctrl

# View logs to confirm monitoring started
kubectl logs -n opsctrl -l app.kubernetes.io/name=opsctrl-daemon -f
```

You should see:
```
🚀 Starting opsctrl-daemon...
🔗 Cluster registration is required before starting monitoring...
✅ Cluster registered successfully: <cluster-id>
✅ Monitoring started for 1 namespaces
```

### Installation Options

<details>
<summary><b>Monitor multiple namespaces</b></summary>

```bash
helm install opsctrl-daemon opsctrl/opsctrl-daemon \
  --namespace opsctrl \
  --set clusterRegistration.clusterName="my-cluster" \
  --set clusterRegistration.userEmail="you@example.com" \
  --set monitoring.watchNamespaces="default\,staging\,production" \
  --set secrets.existingSecret="opsctrl-secrets"
```

> Note: Escape commas with `\,` in `--set` or use a values file instead.

</details>

<details>
<summary><b>Using a values file</b></summary>

Create `my-values.yaml`:

```yaml
clusterRegistration:
  clusterName: "production-cluster"
  userEmail: "platform-team@company.com"

monitoring:
  watchNamespaces: "default,staging,production"
  excludeNamespaces: "kube-system,kube-public"
  minRestartThreshold: 3

secrets:
  existingSecret: "opsctrl-secrets"
```

Install with:

```bash
helm install opsctrl-daemon opsctrl/opsctrl-daemon \
  --namespace opsctrl \
  -f my-values.yaml
```

</details>

<details>
<summary><b>Upgrade an existing installation</b></summary>

```bash
helm repo update
helm upgrade opsctrl-daemon opsctrl/opsctrl-daemon \
  --namespace opsctrl \
  --reuse-values
```

</details>

<details>
<summary><b>Uninstall</b></summary>

```bash
helm uninstall opsctrl-daemon --namespace opsctrl
kubectl delete namespace opsctrl
```

</details>

### kubectl (Alternative)

```bash
kubectl apply -f https://raw.githubusercontent.com/Hillyon-Labs/opsctrl_daemon/main/k8s-deployment.yaml
```

See [values.yaml](helm/opsctrl-daemon/values.yaml) for all configuration options.

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `WATCH_NAMESPACES` | Comma-separated namespaces to monitor | Yes | - |
| `OPSCTRL_BACKEND_URL` | Backend API URL | Yes | - |
| `CLUSTER_NAME` | Unique cluster identifier | No | - |
| `WEBHOOK_URL` | Slack webhook URL for alerts | No | - |
| `MIN_RESTART_THRESHOLD` | Container restarts before alerting | No | `3` |
| `LOG_LEVEL` | Logging verbosity (error, warn, info, debug) | No | `info` |

### Monitored Failure Types

| Failure Type | Description |
|--------------|-------------|
| `CrashLoopBackOff` | Container repeatedly crashing |
| `OOMKilled` | Out of memory termination |
| `ImagePullBackOff` | Failed to pull container image |
| `Pending` | Pod stuck in pending state |
| `Failed` | Pod entered failed phase |

## Usage

### Viewing Logs

```bash
kubectl logs -n monitoring -l app.kubernetes.io/name=opsctrl-daemon -f
```

### Health Check

```bash
kubectl port-forward -n monitoring svc/opsctrl-daemon 3000:3000
curl http://localhost:3000/health
```

### Example Slack Alert

When a failure is detected, you'll receive alerts like:

```
🛑 CrashLoopBackOff in orders-api (production)

Root Cause: Readiness probe failing on /healthz - connection timeout after 1s

Suggested Fix:
kubectl patch deployment orders-api -n production \
  --type='json' \
  -p='[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/timeoutSeconds","value":5}]'
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Kubernetes Cluster                       │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Pod A     │    │   Pod B     │    │   Pod C     │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                 │                  │              │
│         └────────────────┼──────────────────┘              │
│                          ▼                                  │
│                 ┌─────────────────┐                        │
│                 │ OpsCtrl Daemon  │ ◄── Watch API          │
│                 └────────┬────────┘                        │
└──────────────────────────┼──────────────────────────────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │ OpsCtrl Backend │ ◄── LLM Analysis
                  └────────┬────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │     Slack       │
                  └─────────────────┘
```

## Development

### Prerequisites

- Node.js 20+
- npm
- Access to a Kubernetes cluster (local or remote)

### Setup

```bash
# Clone the repository
git clone https://github.com/Hillyon-Labs/opsctrl_daemon.git
cd opsctrl_daemon

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your configuration

# Run in development mode
npm run dev
```

### Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

### Building

```bash
# Build TypeScript
npm run build

# Build Docker image
docker build -t opsctrl/daemon:local .
```

## RBAC & Security

The daemon operates in read-only mode and requires minimal permissions:

| Resource | Verbs | Purpose |
|----------|-------|---------|
| `pods` | get, list, watch | Monitor pod status |
| `namespaces` | get, list, watch | Namespace filtering |
| `events` | get, list, watch, create | Failure detection |
| `leases` | get, list, watch, create, update, patch | Leader election |

The daemon does **not**:
- Execute into containers
- Access Secrets or ConfigMaps
- Modify any workloads
- Send container logs externally

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) before submitting a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Support

- [GitHub Issues](https://github.com/Hillyon-Labs/opsctrl_daemon/issues) - Bug reports and feature requests
- [Documentation](https://github.com/Hillyon-Labs/opsctrl_daemon#readme) - Full documentation

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

Built with care by [Hillyon Labs](https://github.com/Hillyon-Labs)
