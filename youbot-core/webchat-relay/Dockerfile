FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js .
COPY persistence.js .
COPY telemetry.js .
COPY install.sh .
COPY public/ public/
COPY website/ website/
USER node
EXPOSE 8080
CMD ["node", "server.js"]
