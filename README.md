# Optimal CI Matrix

GitHub Action that generates optimal CI matrix for parallel job execution. Automatically determines the optimal number of parallel jobs based on file count, allowing your CI to scale dynamically without manual configuration. Works with single projects or monorepos.

## Features

- **Language Agnostic**: Works with any CI setup, not tied to a specific language or framework
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
        uses: ./
        with:
          projects: '["."]'
          files-per-job: 50
          max-jobs: 10

  test:
    needs: generate-matrix
    strategy:
      matrix:
        include: ${{ fromJson(needs.generate-matrix.outputs.matrix || '[]') }}
    # Use ${{ matrix.project }} and ${{ matrix.batch }} in your test steps
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
        uses: ./
        with:
          projects: '["project1", "project2", "project3"]'
          files-per-job: 50
          max-jobs: 10

  test:
    needs: generate-matrix
    strategy:
      matrix:
        include: ${{ fromJson(needs.generate-matrix.outputs.matrix || '[]') }}
    # Use ${{ matrix.project }} and ${{ matrix.batch }} in your test steps
```

### Scala/SBT Example (Test-Count Mode)

For Scala projects, test-count mode provides more accurate job splitting by counting actual tests rather than files:

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
        uses: ./
        with:
          projects: '["project1", "project2"]'
          base-path: .
          mode: test-count
          tests-per-job: 100
          min-jobs: 1
          max-jobs: 15
          file-patterns: '**/*Test.scala,**/*Spec.scala'

  test:
    needs: generate-matrix
    strategy:
      matrix:
        include: ${{ fromJson(needs.generate-matrix.outputs.matrix || '[]') }}
    # Use ${{ matrix.project }} and ${{ matrix.batch }} in your test steps
```

### TypeScript/JavaScript Example

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
        uses: ./
        with:
          projects: '["frontend", "backend", "shared"]'
          base-path: packages
          files-per-job: 30
          min-jobs: 1
          max-jobs: 5
          file-patterns: 'test/**/*.ts,**/*.test.ts,**/*.spec.ts'

  test:
    needs: generate-matrix
    strategy:
      matrix:
        include: ${{ fromJson(needs.generate-matrix.outputs.matrix || '[]') }}
    # Use ${{ matrix.project }} and ${{ matrix.batch }} in your test steps
```

### Python Example

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
        uses: ./
        with:
          projects: '["api", "worker", "shared"]'
          base-path: services
          files-per-job: 20
          file-patterns: 'tests/**/*.py,**/*_test.py,**/*_integration_test.py'

  test:
    needs: generate-matrix
    strategy:
      matrix:
        include: ${{ fromJson(needs.generate-matrix.outputs.matrix || '[]') }}
    # Use ${{ matrix.project }} and ${{ matrix.batch }} in your test steps
```

### Go Example

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
        uses: ./
        with:
          projects: '["cmd/api", "cmd/worker", "internal"]'
          base-path: .
          files-per-job: 25
          file-patterns: '**/*_test.go,**/*_integration_test.go'

  test:
    needs: generate-matrix
    strategy:
      matrix:
        include: ${{ fromJson(needs.generate-matrix.outputs.matrix || '[]') }}
    # Use ${{ matrix.project }} and ${{ matrix.batch }} in your test steps
```

## Inputs

| Input           | Description                                                                                                                                                         | Required | Default      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------ |
| `projects`      | JSON array of project names/paths to include in the matrix. For single project use `["."]`, for multiple projects use `["project1", "project2"]`                    | Yes      | -            |
| `base-path`     | Base path for project directories. For single project, leave as `.`                                                                                                 | No       | `.`          |
| `mode`          | Counting mode: `"file-count"` (count files) or `"test-count"` (count tests within files). Test-count is more accurate when files can have varying numbers of tests. | No       | `file-count` |
| `files-per-job` | Target number of files per job when using file-count mode                                                                                                           | No       | `50`         |
| `tests-per-job` | Target number of tests per job when using test-count mode                                                                                                           | No       | `100`        |
| `min-jobs`      | Minimum number of parallel jobs per project                                                                                                                         | No       | `1`          |
| `max-jobs`      | Maximum number of parallel jobs per project                                                                                                                         | No       | `10`         |
| `file-patterns` | Comma-separated glob patterns to count files for job splitting                                                                                                      | No       | `**/*`       |

## Outputs

| Output   | Description                                                                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matrix` | JSON array of matrix entries with project and batch dimensions (e.g., `[{"project":"p1","batch":1},{"project":"p1","batch":2},{"project":"p2","batch":1}]`) |

## How It Works

1. **Project Analysis**: For each project in the input list, the action analyzes files matching the specified patterns:
   - **File-count mode** (default): Counts files
   - **Test-count mode**: Counts actual tests within files by parsing test constructs
2. **Job Calculation**: Calculates optimal number of parallel jobs based on:
   - Count (files or tests) ÷ items-per-job (rounded up)
   - Constrained by `min-jobs` and `max-jobs`
3. **Matrix Generation**: Creates a GitHub Actions matrix with entries for each project-batch combination. For single projects, the `project` field will be the path you provided (e.g., `"."`).

### Counting Modes

**File-Count Mode** (default):

- Counts files matching patterns
- Good for: Projects where file count correlates with execution time
- Use when: Files have similar test counts or you want simple job splitting

**Test-Count Mode**:

- Counts actual tests in files (parses test constructs)
- Good for: Projects where files can have varying numbers of tests (e.g., 1-100+ tests per file)
- More accurate: Better reflects actual execution time
- **Note**: Each parallel job may need to compile the project independently. Consider:
  - Using incremental compilation if your build system supports it
  - Caching build artifacts between jobs
  - Pre-compiling in a separate job and having test jobs depend on it
  - Whether compilation overhead outweighs the benefits of more accurate test distribution

### Example Calculation (File-Count Mode)

Given:

- `project1` has 30 files
- `project2` has 150 files
- `files-per-job: 50`
- `min-jobs: 1`
- `max-jobs: 10`

Results:

- `project1`: 30 ÷ 50 = 0.6 → 1 job (minimum)
- `project2`: 150 ÷ 50 = 3 jobs

### Example Calculation (Test-Count Mode)

Given:

- `project1` has 50 files with 80 total tests
- `project2` has 30 files with 250 total tests
- `tests-per-job: 100`
- `min-jobs: 1`
- `max-jobs: 10`

Results:

- `project1`: 80 ÷ 100 = 0.8 → 1 job (minimum)
- `project2`: 250 ÷ 100 = 2.5 → 3 jobs

Matrix:

```json
[
  { "project": "project1", "batch": 1 },
  { "project": "project2", "batch": 1 },
  { "project": "project2", "batch": 2 },
  { "project": "project2", "batch": 3 }
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

The action works with any file patterns you specify via the `file-patterns` input. Use patterns that match your project's test file naming conventions.

### Using Batch Numbers

The `batch` number in the matrix can be used to split work within each project. How you use it depends on your test framework and requirements.

## Tips & Best Practices

### Choosing Between File-Count and Test-Count Mode

- **Use file-count mode** when:
  - Files have similar test counts
  - Compilation time is a significant concern
  - Your build system doesn't support efficient test filtering

- **Use test-count mode** when:
  - Files have widely varying test counts (e.g., 1-100+ tests per file)
  - Test execution time varies significantly
  - Your build system supports incremental compilation or test filtering
  - You can cache build artifacts or pre-compile in a separate job

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

## Requirements

- Node.js 24+ (automatically provided by GitHub Actions)
- pnpm 10+ (managed via corepack)

## Building

Before using this action (or when developing), you need to build it:

```bash
corepack enable
pnpm install
pnpm run build
```

When using this action from the same repository (`uses: ./`), build it first or commit the `dist/` directory.

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
