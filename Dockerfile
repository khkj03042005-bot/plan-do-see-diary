FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=8080
EXPOSE 8080
# DATABASE_URL(PostgreSQL 접속 문자열)은 코드에 넣지 않고 배포 서비스의 환경변수로 주입한다.
CMD ["node", "server.js"]
