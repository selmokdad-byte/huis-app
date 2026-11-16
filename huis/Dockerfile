# Werkt met docker compose én als Home Assistant-add-on (die geeft BUILD_FROM mee).
ARG BUILD_FROM=node:22-alpine
FROM ${BUILD_FROM}
WORKDIR /app
# Node regelt de tijdzone zelf (ingebouwde ICU-data), extra pakketten zijn niet nodig.
# Als add-on zet Home Assistant TZ automatisch op jouw tijdzone.
ENV NODE_ENV=production TZ=Europe/Amsterdam DATA_DIR=/data
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
VOLUME /data
EXPOSE 8080
CMD ["node", "server.js"]
