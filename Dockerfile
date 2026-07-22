FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci && npx playwright install chromium

COPY . .

ENV NODE_ENV=production

CMD ["node", "server.js"]
