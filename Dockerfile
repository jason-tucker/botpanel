# Caddy + bundled landing page. Phase 0 image — no Node.js yet.
# The MVP build will add a second stage that builds Next.js; Caddy will
# proxy to it. For now this is all you need.
FROM caddy:2.10-alpine

# Bake landing files into the image so a `docker compose pull` is all the host
# needs to deploy a new build. Caddyfile is also baked in.
COPY landing/ /srv/landing/
COPY Caddyfile /etc/caddy/Caddyfile

# Surface the build's git SHA into a meta tag the landing page renders.
# CI sets GIT_SHA at build time:  --build-arg GIT_SHA=$(git rev-parse --short HEAD)
ARG GIT_SHA=dev
ARG BUILD_TIME=unknown
RUN sed -i \
  -e "s|</head>|<meta name=\"build-sha\" content=\"${GIT_SHA}\"><meta name=\"build-time\" content=\"${BUILD_TIME}\"></head>|" \
  /srv/landing/index.html

EXPOSE 6080

# caddy:2-alpine's default entrypoint reads /etc/caddy/Caddyfile.
