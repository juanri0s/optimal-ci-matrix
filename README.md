# Optimal CI Matrix

GitHub Action that generates optimal CI matrix for parallel job execution. Automatically determines the optimal number of parallel jobs based on file count or test count, allowing your CI to scale dynamically without manual configuration. Works with single projects or monorepos.

## Features

- **Language Agnostic**: Works with any CI setup, not tied to a specific language or framework
- **Single Project or Monorepo**: Handles both single projects and multiple projects with different parallelization requirements
- **Dynamic Job Splitting**: Automatically calculates optimal parallel jobs based on file count or test count
- **Bin-Packing Algorithm**: Uses optimal distribution algorithm in test-count mode for balanced batches
- **Heavy Test Isolation**: Automatically isolates large test files to prevent bottlenecks
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
        uses: juanri0s/optimal-ci-matrix@v1 # Pin to exact commit SHA for production
        with:
          projects: '["project1", "project2"]'
          base-path: .
          mode: test-count
          tests-per-job: 100
          max-tests-per-file: 25
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
        uses: juanri0s/optimal-ci-matrix@v1 # Pin to exact commit SHA for production
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
        uses: juanri0s/optimal-ci-matrix@v1 # Pin to exact commit SHA for production
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
        uses: juanri0s/optimal-ci-matrix@v1 # Pin to exact commit SHA for production
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

| Input                | Description                                                                                                                                                         | Required | Default      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------ |
| `projects`           | JSON array of project names/paths to include in the matrix. For single project use `["."]`, for multiple projects use `["project1", "project2"]`                    | Yes      | -            |
| `base-path`          | Base path for project directories. For single project, leave as `.`                                                                                                 | No       | `.`          |
| `mode`               | Counting mode: `"file-count"` (count files) or `"test-count"` (count tests within files). Test-count is more accurate when files can have varying numbers of tests. | No       | `file-count` |
| `files-per-job`      | Target number of files per job when using file-count mode                                                                                                           | No       | `50`         |
| `tests-per-job`      | Target number of tests per job when using test-count mode                                                                                                           | No       | `100`        |
| `max-tests-per-file` | Threshold for isolating heavy test files. Files with this many or more tests get their own batch. Only used in test-count mode. Set to 0 to disable.                | No       | `0`          |
| `min-jobs`           | Minimum number of parallel jobs per project                                                                                                                         | No       | `1`          |
| `max-jobs`           | Maximum number of parallel jobs per project                                                                                                                         | No       | `10`         |
| `file-patterns`      | Comma-separated glob patterns to count files for job splitting                                                                                                      | No       | `**/*`       |

## Outputs

| Output   | Description                                                                                                                                                                                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matrix` | JSON array of matrix entries with project and batch dimensions. In test-count mode, entries include `testCount` and `files` fields indicating tests and file paths in that batch. (e.g., `[{"project":"p1","batch":1},{"project":"p1","batch":2,"testCount":45,"files":["file1.scala","file2.scala"]}]`) |

## How It Works

1. **Project Analysis**: For each project in the input list, the action analyzes files matching the specified patterns:
   - **File-count mode** (default): Counts files
   - **Test-count mode**: Counts actual tests within files by parsing test constructs
2. **Job Calculation**: Calculates optimal number of parallel jobs based on:
   - **File-count mode**: Simple division (count ÷ items-per-job, rounded up)
   - **Test-count mode**: Bin-packing algorithm for better distribution, with optional heavy test isolation
   - Constrained by `min-jobs` and `max-jobs`
3. **Matrix Generation**: Creates a GitHub Actions matrix with entries for each project-batch combination. In test-count mode, each entry includes `testCount` indicating the number of tests and `files` array indicating which files belong to that batch.

### Counting Modes

**File-Count Mode** (default):

- Counts files matching patterns
- Good for: Projects where file count correlates with execution time
- Use when: Files have similar test counts or you want simple job splitting

**Test-Count Mode**:

- Counts actual tests in files (parses test constructs)
- Uses bin-packing algorithm for optimal test distribution across batches
- Good for: Projects where files can have varying numbers of tests (e.g., 1-100+ tests per file)
- More accurate: Better reflects actual execution time and provides balanced batches
- **Heavy test isolation**: When `max-tests-per-file` is set, files with that many or more tests get their own batch to prevent bottlenecks
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

- `project1` has files with 80 total tests distributed across files
- `project2` has files with 250 total tests distributed across files
- `tests-per-job: 100`
- `max-tests-per-file: 25`
- `min-jobs: 1`
- `max-jobs: 10`

Results (using bin-packing algorithm):

- `project1`: 80 tests → 1 batch (minimum)
- `project2`: 250 tests → 3 batches (distributed using bin-packing for optimal balance)

Matrix:

```json
[
  { "project": "project1", "batch": 1, "testCount": 80, "files": ["file1.scala", "file2.scala"] },
  { "project": "project2", "batch": 1, "testCount": 95, "files": ["file3.scala", "file4.scala"] },
  { "project": "project2", "batch": 2, "testCount": 85, "files": ["file5.scala"] },
  { "project": "project2", "batch": 3, "testCount": 70, "files": ["file6.scala", "file7.scala"] }
]
```

**Note**: The bin-packing algorithm distributes tests across batches to balance execution time. Each batch includes `testCount` (number of tests) and `files` (array of file paths) for visibility and debugging.

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

### Using Batch Numbers and Matrix Fields

The matrix entries include:

- **`project`**: Project name/path
- **`batch`**: Batch number (1-indexed) for splitting work within each project
- **`testCount`** (test-count mode only): Number of tests in this batch
- **`files`** (test-count mode only): Array of file paths belonging to this batch

**File-count mode** entries only include `project` and `batch`.  
**Test-count mode** entries include `project`, `batch`, `testCount`, and `files`.

How you use these fields depends on your test framework and requirements. The `files` array can be used to filter which tests to run in each batch.

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
  - You want optimal test distribution using bin-packing algorithm

### Using `max-tests-per-file`

When using test-count mode, you can set `max-tests-per-file` to isolate large test files:

- **Purpose**: Prevents bottlenecks from files with many tests
- **How it works**: Files with `max-tests-per-file` or more tests get their own batch
- **Example**: With `max-tests-per-file: 25`, a file with 30 tests gets its own batch
- **Recommendation**: Set to 25-50 for most projects, or 0 to disable

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
