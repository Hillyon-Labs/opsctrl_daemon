Here’s a production-ready, developer-focused `README.md` for the **Opsctrl Daemon** repo — clear, technical, and compelling without sounding hypey:

---

````md
# Opsctrl Daemon

**Your Kubernetes cluster’s missing brain.**  
The Opsctrl daemon installs once and continuously monitors your workloads for failures — then posts detailed diagnoses and fixes directly to Slack.

## 🚀 What It Does

When something breaks in your cluster, Opsctrl tells you:

- **What broke** (pod crash, stuck rollout, probe failure, OOMKill)
- **Why it broke** (misconfigured resources, upstream errors, bad Helm changes)
- **How to fix it** (suggested remediations, config updates, next steps)

All delivered in plain English, straight to your Slack.

No dashboards. No digging through logs.  
Just answers — where your team actually works.

## 🔧 How It Works

- Deployed as a lightweight Deployment or DaemonSet
- Uses the Kubernetes API to watch pod states, events, and Helm metadata
- Triggers diagnosis automatically when failures occur
- Sends structured metadata to the Opsctrl backend for LLM-powered analysis
- Posts root cause + suggested fix to your configured Slack channel

## ⚡️ Quickstart

```bash
kubectl apply -f https://get.opsctrl.dev/latest.yaml
````

> Requires Kubernetes 1.21+, cluster read access (pods, events, deployments), and a Slack webhook URL.

## 🛡 RBAC & Security

The daemon:

* Runs read-only
* Requires access to:

  * Pods
  * Events
  * Deployments
  * (Optional) Helm secrets
* Does **not** exec into containers, access secrets/configMaps, or send logs externally

Full [RBAC manifest here](./manifests/rbac.yaml)

## 📥 Slack Integration

1. Generate a Slack webhook: [https://api.slack.com/messaging/webhooks](https://api.slack.com/messaging/webhooks)
2. Pass it to the daemon via Helm values or env var:

   ```bash
   export SLACK_WEBHOOK=https://hooks.slack.com/services/...
   ```
3. You’ll receive incident alerts like:

   > 🛑 CrashLoopBackOff in `orders-api`
   > 🧠 Root cause: readiness probe failing on `/healthz`
   > 🔧 Fix: kubectl patch deployment payments-api \
  -n production \
  --type='json' \
  -p='[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/timeoutSeconds","value":5}]'

## 💡 Why Open Source?

Transparency. Trust. Customization.

You can audit, fork, or self-host this daemon — but our full diagnosis pipeline (including the LLM-based analysis and Slack formatting) runs on the Opsctrl backend. To unlock that, head to [opsctrl.dev](https://opsctrl.dev).

## 🧪 Local Development

```bash
npm install
npm run dev
```

You’ll need a working KUBECONFIG and access to a dev cluster. The default watcher observes all namespaces unless scoped.

## 📄 License

MIT 

---

Want to contribute? Open an issue or ping us in [#opsctrl on Kubernetes discord](https://discord.gg/WPvXpRFb).
