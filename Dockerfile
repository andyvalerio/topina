# Zero runtime dependencies, so there is nothing to install: the image is the
# Node base plus a handful of .js files.
FROM node:22-slim

# The token cache must outlive the container. Without a volume behind it every
# restart is a real login, and a crash-loop would lock the account out of the
# Tractive API entirely — taking the monitor down in a way a restart cannot
# fix (see requirements D1, C20).
RUN mkdir -p /config /data && chown -R node:node /config /data

WORKDIR /app
COPY package.json ./
COPY *.js dashboard.html ./

USER node

ENV NODE_ENV=production
ENV PORT=8080
ENV TOKEN_CACHE_PATH=/config/token.json
ENV DB_PATH=/config/topina.db

EXPOSE 8080
VOLUME ["/config"]

CMD ["node", "server.js"]
