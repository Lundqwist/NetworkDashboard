# Runs the dashboard server in a container, e.g. on a Raspberry Pi as an always-on feed.
# Mount your config at /app/config.json and pass secrets as environment variables.
# The "local" (Windows PC) and "printer" (Windows) panel types don't work in a container.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/index.js", "--config", "/app/config.json"]
