test:
    npm run test

lint:
    npm run lint || true

build:
    npm run compile

preflight: build test lint
