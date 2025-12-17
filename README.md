# Optimal CI Matrix

GitHub Action that generates optimal CI matrix for parallel job execution. Automatically determines the optimal number of parallel jobs based on file count, allowing your CI to scale dynamically without manual configuration. Works with single projects or monorepos.

## Features

- **Language Agnostic**: Works with any programming language or framework
- **Single Project or Monorepo**: Handles both single projects and multiple projects with different parallelization requirements
- **Dynamic Job Splitting**: Automatically calculates optimal parallel jobs based on file count
- **Flexible Configuration**: Customize file patterns, job limits, and base paths

## Usage

### Single Project Example

```yaml
jobs:
  generate-matrix:
    name: Generate CI Matrix
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.set-matrix.outputs.matrix }}
    steps:
      - uses: actions/checkout@v4

      - name: Generate Optimal Matrix
        id: set-matrix
        uses: juanri0s/optimal-ci-matrix@v1 # Pin to exact commit SHA for production
        with:
          projects: '["."]'
          files-per-job: 50
          max-jobs: 10

  test:
    needs: generate-matrix
    strategy:
      matrix:
        include: ${{ fromJson(needs.generate-matrix.outputs.matrix || '[]') }}
    steps:
      - uses: actions/checkout@v4
      # Use ${{ matrix.project }} and ${{ matrix.batch }} to run tests
      # Use ${{ matrix.total_batches }} to determine how to split work
```

### Multiple Projects Example

```yaml
jobs:
  generate-matrix:
    name: Generate CI Matrix
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.set-matrix.outputs.matrix }}
    steps:
      - uses: actions/checkout@v4

      - name: Generate Optimal Matrix
        id: set-matrix
        uses: juanri0s/optimal-ci-matrix@v1 # Pin to exact commit SHA for production
        with:
          projects: '["project1", "project2", "project3"]'
          files-per-job: 50
          max-jobs: 10

  test:
    needs: generate-matrix
    strategy:
      matrix:
        include: ${{ fromJson(needs.generate-matrix.outputs.matrix || '[]') }}
    steps:
      - uses: actions/checkout@v4
      # Use ${{ matrix.project }} and ${{ matrix.batch }} to run tests
      # Use ${{ matrix.total_batches }} to determine how to split work
```

### Custom File Patterns Example

```yaml
jobs:
  generate-matrix:
    name: Generate CI Matrix
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.set-matrix.outputs.matrix }}
    steps:
      - uses: actions/checkout@v4

      - name: Generate Optimal Matrix
        id: set-matrix
        uses: juanri0s/optimal-ci-matrix@v1 # Pin to exact commit SHA for production
        with:
          projects: '["frontend", "backend", "shared"]'
          base-path: packages
          files-per-job: 30
          min-jobs: 1
          max-jobs: 5
          file-patterns: '**/*.test.*,**/*.spec.*,tests/**/*'

  test:
    needs: generate-matrix
    strategy:
      matrix:
        include: ${{ fromJson(needs.generate-matrix.outputs.matrix || '[]') }}
    steps:
      - uses: actions/checkout@v4
      # Use ${{ matrix.project }} and ${{ matrix.batch }} to run tests
```

## Inputs

| Input           | Description                                                                                                                                    | Required | Default |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- |
| `projects`      | JSON array of project names or paths to include in the matrix. For single project use `["."]`, for multiple projects use `["project1", "project2"]` | Yes      | -       |
| `base-path`     | Base path for project directories. Use "." for current directory or specify a relative path to your projects.                                | No       | `.`     |
| `files-per-job` | Target number of files per job. Used to calculate optimal batch count. Adjust based on your project size and desired parallelism.            | No       | `50`    |
| `min-jobs`      | Minimum number of parallel jobs per project. Ensures minimum parallelism even for small projects.                                            | No       | `1`     |
| `max-jobs`       | Maximum number of parallel jobs per project. Prevents excessive job creation for very large projects.                                          | No       | `10`    |
| `file-patterns` | Comma-separated glob patterns to match files for counting. Use patterns that match your test files or files you want to parallelize.          | No       | `**/*`  |

## Outputs

| Output   | Description                                                                                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `matrix` | JSON array of matrix entries. Each entry contains `project` (project name/path), `batch` (batch number, 1-indexed), and `total_batches` (total number of batches for this project). Use `total_batches` to determine how many batches each project should be split into. Example: `[{"project":"p1","batch":1,"total_batches":3},{"project":"p1","batch":2,"total_batches":3}]` |

## How It Works

1. **Project Analysis**: For each project in the input list, the action analyzes files matching the specified patterns and counts them.
2. **Job Calculation**: Calculates optimal number of parallel jobs based on:
   - File count divided by `files-per-job` (rounded up)
   - Constrained by `min-jobs` and `max-jobs`
3. **Matrix Generation**: Creates a GitHub Actions matrix with entries for each project-batch combination. Each entry includes the project name, batch number, and total batches.

### Example Calculation

Given:

- `project1` has 30 files
- `project2` has 150 files
- `files-per-job: 50`
- `min-jobs: 1`
- `max-jobs: 10`

Results:

- `project1`: 30 ÷ 50 = 0.6 → 1 job (minimum)
- `project2`: 150 ÷ 50 = 3 jobs

Matrix:

```json
[
  { "project": "project1", "batch": 1, "total_batches": 1 },
  { "project": "project2", "batch": 1, "total_batches": 3 },
  { "project": "project2", "batch": 2, "total_batches": 3 },
  { "project": "project2", "batch": 3, "total_batches": 3 }
]
```

## Use Cases

### Single Project

For a single project, the action automatically splits it into parallel jobs based on file count:

- Small project: 1 parallel job
- Medium project: 2-3 parallel jobs
- Large project: 5-10 parallel jobs

**Example**: A project with 200 test files will automatically be split into 4 parallel jobs (with `files-per-job: 50`), reducing CI time significantly.

### Monorepo with Multiple Projects

In a monorepo, different projects may have vastly different sizes:

- Small utility project: 1 parallel job
- Large application: 5-10 parallel jobs
- Medium-sized service: 2-3 parallel jobs

This action automatically determines the optimal job splitting for each project, so you don't need to manually configure parallelization for each one.

**Example**: In a monorepo with 5 projects:

- `utils` (10 files) → 1 job
- `api` (150 files) → 3 jobs
- `frontend` (80 files) → 2 jobs
- `worker` (200 files) → 4 jobs
- `shared` (5 files) → 1 job

Total: 11 parallel jobs instead of manually configuring each project.

### Dynamic Scaling

As projects grow, the job splitting automatically adapts:

- This month: Project A needs 2 parallel jobs
- Next month: Project A needs 4 parallel jobs (no manual configuration needed)

No need to update your workflow file as projects evolve - the action handles it automatically.

### Custom File Patterns

The action works with any file patterns you specify via the `file-patterns` input. Use patterns that match your project's test file naming conventions or files you want to parallelize.

### Using Batch Numbers and Matrix Fields

The matrix entries include:

- **`project`**: Project name/path
- **`batch`**: Batch number (1-indexed) for splitting work within each project
- **`total_batches`**: Total number of batches for this project

How you use these fields depends on your test framework and requirements. The `total_batches` value tells you how many batches each project should be split into, and `batch` tells you which batch this job should process.

## Tips & Best Practices

### Choosing `files-per-job`

- **Small projects (< 50 files)**: Use `files-per-job: 10-20` for finer granularity
- **Medium projects (50-200 files)**: Use `files-per-job: 30-50` (default)
- **Large projects (> 200 files)**: Use `files-per-job: 50-100` to avoid too many jobs

### Setting `min-jobs` and `max-jobs`

- **`min-jobs`**: Useful when you want to ensure parallelization even for small projects
- **`max-jobs`**: Prevents runaway job creation for very large projects (recommended: 10-20)

### File Patterns

Use patterns to count only relevant files:

- **Tests only**: `test/**/*`, `**/*_test.*`, `tests/**/*`
- **Source + tests**: `**/*` (all files)
- **Multiple patterns**: `**/*.ts,**/*.tsx,**/*.js` (comma-separated)

### Project Names

- Use simple project names without path separators (e.g., `"project1"` not `"project1/subproject"`)
- For single project, use `["."]` as the project name
- Project names are used as-is in the matrix output

## Requirements

- Node.js 24+ (automatically provided by GitHub Actions)

## Building

Before using this action (or when developing), you need to build it:

```bash
corepack enable
pnpm install
pnpm run build
```

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage

# Lint code
pnpm lint

# Format code
pnpm format

# Build
pnpm build
```

## License

MIT
