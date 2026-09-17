FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server.js .
COPY --chown=node:node persistence.js .
COPY --chown=node:node telemetry.js .
COPY --chown=node:node install.sh .
COPY --chown=node:node public/ public/
COPY --chown=node:node website/ website/
USER node
EXPOSE 8080
CMD ["node", "server.js"]
