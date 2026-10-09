FROM node:20-alpine

WORKDIR /app

# Copy root and workspace package files
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY services/gateway/package.json ./services/gateway/

# Install dependencies
RUN npm ci

# Copy sources
COPY tsconfig.base.json ./
COPY proto/ ./proto/
COPY packages/shared/ ./packages/shared/
COPY services/gateway/ ./services/gateway/

EXPOSE 8080

CMD ["npm", "--workspace=@bank/gateway", "start"]
