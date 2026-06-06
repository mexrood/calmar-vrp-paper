FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
ENV PORT=8080
ENV VRP_STATE=/data/vrp-paper.json
ENV TICK_MS=900000
EXPOSE 8080
CMD ["npx", "tsx", "server.ts"]
