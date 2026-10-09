# Multi-stage build for frontend
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY frontend/package*.json ./frontend/
RUN npm ci --workspace=packages/shared --workspace=@bank/frontend

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY frontend ./frontend

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=@bank/frontend

FROM nginx:alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
