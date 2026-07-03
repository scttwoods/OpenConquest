# Stage 1: build client (Vite -> dist/) and server bundle (esbuild -> dist-server/)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: minimal runtime. The server bundle is self-contained (esbuild
# bundles all dependencies), so no node_modules are needed here.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
EXPOSE 8080
CMD ["node", "dist-server/index.js"]
