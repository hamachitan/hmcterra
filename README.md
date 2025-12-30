# Hamachitan — GitHub Terra Monorepo Edition

GitHub bot in [Terra monorepo](https://github.com/terrapkg/packages).

## Setup

```sh
# Install dependencies
bun install

# Run the bot
bun start
```

## Docker

```sh
# 1. Build container
docker build -t hmcterra .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> hmcterra
```

## Contributing

If you have suggestions for how hmcterra could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

[ISC](LICENSE) © 2025 madonuko
