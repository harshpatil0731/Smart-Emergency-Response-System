# ==============================================================================
# Stage 1: Build C++ DSA Engine in Linux x86_64
# ==============================================================================
FROM gcc:13-bookworm AS cpp-builder

# Install CMake and Make
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    make \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Copy C++ engine source directory
COPY ds-engine/ ds-engine/

# Configure and compile Release binary for engine_console target
# Statically link libstdc++ and libgcc so the executable is self-contained and
# runs seamlessly in minimal runtime images (such as Debian bookworm-based node:20-slim)
RUN cmake -B ds-engine/build -S ds-engine -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_EXE_LINKER_FLAGS="-static-libstdc++ -static-libgcc" \
    && cmake --build ds-engine/build --config Release --target engine_console -j$(nproc)

# Verify executable was generated at expected location
RUN test -f /src/ds-engine/build/engine_console && chmod +x /src/ds-engine/build/engine_console

# ==============================================================================
# Stage 2: Production Node.js Runtime
# ==============================================================================
FROM node:22-slim AS runner

# Create directory for C++ engine executable and backend application
RUN mkdir -p /app/engine /app/backend

# Copy compiled Linux C++ engine executable from Stage 1
COPY --from=cpp-builder /src/ds-engine/build/engine_console /app/engine/engine_console
RUN chmod +x /app/engine/engine_console

WORKDIR /app/backend

# Install production Node.js dependencies
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Copy backend application source and public assets
COPY backend/server.js ./
COPY backend/services/ ./services/
COPY backend/public/ ./public/

# Ensure directory permissions for node user
RUN chown -R node:node /app

# Switch to non-root node user
USER node

# Production environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV ENGINE_BIN_PATH=/app/engine/engine_console

# Expose default port (Render will override via process.env.PORT)
EXPOSE 4000

# Start application from /app/backend
CMD ["node", "server.js"]
