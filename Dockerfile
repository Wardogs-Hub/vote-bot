FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY bot.js ./
ENV CLAIMS_FILE=/data/claims.json
VOLUME /data
USER node
CMD ["node", "bot.js"]
