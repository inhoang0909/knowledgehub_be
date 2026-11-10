FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Copy prisma schema (needed before install for postinstall scripts)
COPY prisma ./prisma/

# Install all dependencies
RUN npm install

# Generate Prisma Client
RUN npx prisma generate

# Copy rest of source code
COPY . .

# Build the application
RUN ls -la
RUN npm run build

# Verify build output
RUN echo "=== dist contents ===" && ls -la dist || true
RUN echo "=== dist/src contents ===" && ls -la dist/src || true

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && if [ -f dist/main.js ]; then node dist/main; else node dist/src/main.js; fi"]