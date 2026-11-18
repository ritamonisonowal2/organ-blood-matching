FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
COPY package.json *.html ./
COPY css/ css/
COPY js/ js/
COPY vendor/chart.umd.min.js vendor/
COPY server/*.mjs server/schema.sql server/

CMD ["node", "server/index.mjs"]
