#!/bin/bash

# Build script for opsctrl-daemon Docker image
set -e

# Configuration
IMAGE_NAME="opsctrl-daemon"
TAG="${1:-latest}"
REGISTRY="${DOCKER_REGISTRY:-localhost}"

echo "🐳 Building Docker image: ${REGISTRY}/${IMAGE_NAME}:${TAG}"

# Build the image
docker build \
  --tag "${REGISTRY}/${IMAGE_NAME}:${TAG}" \
  --tag "${REGISTRY}/${IMAGE_NAME}:latest" \
  --build-arg BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ') \
  --build-arg VCS_REF=$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown') \
  --build-arg VERSION=$(npm run --silent version 2>/dev/null || echo 'unknown') \
  .

echo "✅ Docker image built successfully"

# Optional: Run security scan
if command -v docker-scout &> /dev/null; then
  echo "🔒 Running security scan..."
  docker scout cves "${REGISTRY}/${IMAGE_NAME}:${TAG}" || true
fi

# Optional: Push to registry
if [ "$2" = "push" ]; then
  echo "📤 Pushing image to registry..."
  docker push "${REGISTRY}/${IMAGE_NAME}:${TAG}"
  docker push "${REGISTRY}/${IMAGE_NAME}:latest"
  echo "✅ Image pushed successfully"
fi

echo "🎉 Build complete!"
echo "   Image: ${REGISTRY}/${IMAGE_NAME}:${TAG}"
echo "   Size: $(docker images --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}" | grep ${IMAGE_NAME}:${TAG})"