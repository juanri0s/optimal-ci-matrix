# Basic Commands

## Setup

```bash
pnpm --dir /path/to/optimal-ci-matrix install
```

## Development

```bash
# Build the action
pnpm --dir /path/to/optimal-ci-matrix build

# Run tests
pnpm --dir /path/to/optimal-ci-matrix test

# Run tests in watch mode
pnpm --dir /path/to/optimal-ci-matrix test:watch

# Run tests with coverage
pnpm --dir /path/to/optimal-ci-matrix test:coverage
```

## Code Quality

```bash
# Lint code
pnpm --dir /path/to/optimal-ci-matrix lint

# Fix linting issues
pnpm --dir /path/to/optimal-ci-matrix lint:fix

# Format code
pnpm --dir /path/to/optimal-ci-matrix format

# Check formatting
pnpm --dir /path/to/optimal-ci-matrix format:check
```

## Testing

- Tests are in `src/index.test.ts`
- Coverage threshold: 100% lines/functions/statements, 98% branches (always strive for 100%)
