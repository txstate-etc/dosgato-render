# Pin the Playwright image so the preinstalled runner always matches the
# @playwright/test version in test/package.json.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

COPY test/package.json ./
RUN npm --quiet install
COPY test/playwright.config.ts ./
COPY test/tests tests

CMD npm run playwright
