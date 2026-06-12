 # ================================================
# Stage 1: Install dependencies (prod + dev)
# ================================================
FROM node:20-alpine AS deps
WORKDIR /app

# Install system dependencies (needed for some npm packages)
RUN apk add --no-cache libc6-compat

# Copy only what's needed for dependency installation
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies)
RUN npm ci --legacy-peer-deps

# ================================================
# Stage 2: Build the application
# ================================================
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependencies from previous stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY . .

# Build arguments
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Build Next.js
RUN npm run build --legacy-peer-deps

# ================================================
# Stage 3: Production image
# ================================================4
FROM node:20-alpine AS production
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -u 1001 -S nextjs -G nodejs

# Copy built assets and dependencies
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json


# Environment variables
ENV NODE_ENV=production
ENV PORT=3000

USER nextjs
EXPOSE 3000
CMD ["npm", "start"]

# ================================================
# Stage 4: Development image (optional)
# ================================================
FROM node:20-alpine AS development
WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies)
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# Environment variables
ENV NODE_ENV=development
ENV PORT=3000

EXPOSE 3000
CMD ["npm", "run", "dev"]

