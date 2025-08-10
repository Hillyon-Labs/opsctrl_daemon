#!/bin/bash

# Environment Setup Script for opsctrl-daemon
set -e

echo "🔧 Setting up opsctrl-daemon environment..."

# Check if .env.local already exists
if [ -f ".env.local" ]; then
  echo "📋 .env.local already exists"
  read -p "Do you want to overwrite it? (y/n): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "✅ Keeping existing .env.local"
    exit 0
  fi
fi

# Copy example file
echo "📄 Creating .env.local from .env.example..."
cp .env.example .env.local

echo "🔧 Please customize .env.local with your settings:"
echo "   1. Set WEBHOOK_URL for Slack/Discord/Teams notifications"
echo "   2. Adjust WATCH_NAMESPACES for your monitoring scope"
echo "   3. Configure alert severity levels and thresholds"
echo ""

# Ask for webhook URL
read -p "Enter your webhook URL (optional, press enter to skip): " webhook_url
if [ ! -z "$webhook_url" ]; then
  # Escape special characters for sed
  escaped_url=$(echo "$webhook_url" | sed 's/[[\.*^$()+?{|]/\\&/g')
  sed -i.bak "s|WEBHOOK_URL=|WEBHOOK_URL=$escaped_url|" .env.local
  rm .env.local.bak 2>/dev/null || true
  echo "✅ Webhook URL configured"
fi

# Ask for namespaces to monitor
read -p "Enter namespaces to monitor (comma-separated, or press enter for all): " namespaces
if [ ! -z "$namespaces" ]; then
  sed -i.bak "s|WATCH_NAMESPACES=|WATCH_NAMESPACES=$namespaces|" .env.local
  rm .env.local.bak 2>/dev/null || true
  echo "✅ Watch namespaces configured: $namespaces"
fi

# Ask for environment mode
echo ""
echo "Select environment mode:"
echo "1) Development (debug logs, lower thresholds, faster reconnection)"
echo "2) Production (info logs, standard thresholds, robust reconnection)"
read -p "Choose mode (1-2, default=1): " env_mode

case $env_mode in
  2)
    sed -i.bak 's|LOG_LEVEL=debug|LOG_LEVEL=info|' .env.local
    sed -i.bak 's|MIN_RESTART_THRESHOLD=2|MIN_RESTART_THRESHOLD=3|' .env.local
    sed -i.bak 's|DEVELOPMENT_MODE=true|DEVELOPMENT_MODE=false|' .env.local
    rm .env.local.bak 2>/dev/null || true
    echo "✅ Production mode configured"
    ;;
  *)
    echo "✅ Development mode configured (default)"
    ;;
esac

echo ""
echo "🎉 Environment setup complete!"
echo ""
echo "Next steps:"
echo "  1. Review and customize .env.local if needed"
echo "  2. Ensure kubectl is configured for your cluster"
echo "  3. Run: npm run dev (for development)"
echo "  4. Or run: npm run docker:run (for Docker)"
echo "  5. Check health: curl http://localhost:3000/health"
echo ""
echo "📖 For more configuration options, see .env.example"