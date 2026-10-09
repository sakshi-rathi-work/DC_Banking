FROM node:20-alpine

WORKDIR /app

# Copy root and workspace package files
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY services/bank-node/package.json ./services/bank-node/
COPY database/migrations/ ./database/migrations/

# Install dependencies
RUN npm ci

# Copy sources
COPY tsconfig.base.json ./
COPY proto/ ./proto/
COPY packages/shared/ ./packages/shared/
COPY services/bank-node/ ./services/bank-node/

EXPOSE 50051 9000

CMD ["npm", "--workspace=@bank/bank-node", "start"]
