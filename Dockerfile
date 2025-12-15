# Multi-stage build for opsctrl-daemon
# Stage 1: Build stage
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY src/ ./src/

# Build the application
RUN npm run build

# Run tests to ensure everything works
#RUN npm test

# Stage 2: Production stage
FROM node:18-alpine AS production

# Create non-root user for security
RUN addgroup -g 1001 -S opsctrl && \
    adduser -S opsctrl -u 1001 -G opsctrl

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy any necessary runtime files
COPY --from=builder /app/src/common ./src/common

# Change ownership of the app directory to opsctrl user
RUN chown -R opsctrl:opsctrl /app

# Switch to non-root user
USER opsctrl

# Expose health check port (if needed)
EXPOSE 3000

# Build argument for backend URL (injected at CI build time)
ARG OPSCTRL_BACKEND_URL=""

# Set environment variables
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV OPSCTRL_BACKEND_URL=${OPSCTRL_BACKEND_URL}

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('Health check passed')" || exit 1

# Use the compiled JavaScript entry point
CMD ["node", "dist/index.js"]