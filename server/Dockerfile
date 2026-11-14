FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY ./ ./
ENV NODE_ENV=production
USER node
EXPOSE 8787
CMD ["node","server.mjs"]
