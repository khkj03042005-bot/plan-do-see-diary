FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=8080 DB_PATH=/data/pds.db
VOLUME /data
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
