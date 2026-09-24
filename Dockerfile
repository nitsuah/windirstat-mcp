FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY index.js .
COPY lib/ ./lib/
COPY config.default.json .

EXPOSE 3939

ENTRYPOINT ["node", "index.js"]
