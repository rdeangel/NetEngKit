FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY scripts/build/fetch-mermaid.js ./scripts/build/fetch-mermaid.js
RUN npm install

COPY . .
RUN node scripts/build/bundle.js NetEngKit.html -o NetEngKit.html

# ─────────────────────────────────────────────────────────────
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      curl ca-certificates gnupg \
      iputils-ping dnsutils coreutils bash gawk \
      nmap fping tcpdump tshark iperf iperf3 \
      python3 python3-scapy iproute2 \
 && curl -s https://packagecloud.io/install/repositories/ookla/speedtest-cli/script.deb.sh | bash \
 && apt-get install -y --no-install-recommends speedtest \
 && LIBRE_VER=$(curl -fsSL https://api.github.com/repos/librespeed/speedtest-cli/releases/latest \
      | grep '"tag_name"' | sed 's/[^0-9.]//g') \
 && curl -fsSL "https://github.com/librespeed/speedtest-cli/releases/download/v${LIBRE_VER}/librespeed-cli_${LIBRE_VER}_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin librespeed-cli \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/NetEngKit.html ./NetEngKit.html
COPY scripts/proxy.js ./scripts/
COPY scripts/subnet_scan.sh ./scripts/
COPY scripts/scapy_send.py ./scripts/

# PWA assets (installable / offline-capable app)
COPY manifest.json sw.js ./
COPY icons ./icons

EXPOSE 8080

CMD ["node", "scripts/proxy.js"]
