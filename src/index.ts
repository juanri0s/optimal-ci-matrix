import * as core from '@actions/core';
import { glob } from 'glob';
import { join, resolve, relative } from 'path';
import { statSync, readFileSync } from 'fs';

interface MatrixEntry {
  project: string;
  batch: number;
}

interface ProjectJobInfo {
  project: string;
  fileCount: number;
  testCount?: number;
  jobCount: number;
}

function isValidPath(path: string, baseDir: string): boolean {
  try {
    const resolved = resolve(baseDir, path);
    const baseResolved = resolve(baseDir);
    const relativePath = relative(baseResolved, resolved);
    return !relativePath.startsWith('..') && !relativePath.includes('..');
  } catch {
    return false;
  }
}

/**
 * Counts files in a project directory matching the given patterns
 */
export async function countProjectFiles(
  projectPath: string,
  filePatterns: string[]
): Promise<number> {
  const allFiles = new Set<string>();
  const cwd = process.cwd();

  for (const pattern of filePatterns) {
    const fullPattern = join(projectPath, pattern);
    try {
      const files = await glob(fullPattern, {
        ignore: [
          '**/node_modules/**',
          '**/target/**',
          '**/.git/**',
          '**/dist/**',
          '**/build/**',
          '**/.next/**',
          '**/.nuxt/**',
          '**/.svelte-kit/**',
        ],
        absolute: false,
        nodir: true,
        cwd,
      });

      files.forEach((file) => {
        try {
          const fullPath = resolve(cwd, file);
          if (!isValidPath(file, cwd)) {
            return;
          }
          const stats = statSync(fullPath);
          if (stats.isFile()) {
            allFiles.add(file);
          }
        } catch {
          // Skip files that can't be accessed
        }
      });
    } catch {}
  }

  return allFiles.size;
}

function countTestsInFile(filePath: string, language: string): number {
  const cwd = process.cwd();
  const fullPath = resolve(cwd, filePath);

  if (!isValidPath(filePath, cwd)) {
    return 0;
  }

  try {
    const stats = statSync(fullPath);
    if (!stats.isFile()) {
      return 0;
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (stats.size > MAX_FILE_SIZE) {
      return 1;
    }

    const content = readFileSync(fullPath, 'utf-8');

    switch (language) {
      case 'scala':
        // Count Scala test constructs: test(, it(, should(, in {, property(
        const scalaPattern = /(?:^|\s)(?:test\s*\(|it\s*\(|should\s*\(|in\s*\{|property\s*\()/gm;
        const scalaMatches = content.match(scalaPattern);
        return Math.max(1, scalaMatches ? scalaMatches.length : 1);

      case 'typescript':
      case 'javascript':
        // Count test/it/describe blocks: test(, it(, describe(
        const jsPattern = /(?:^|\s)(?:test\s*\(|it\s*\(|describe\s*\()/gm;
        const jsMatches = content.match(jsPattern);
        return Math.max(1, jsMatches ? jsMatches.length : 1);

      case 'python':
        // Count test functions: def test_, def test, @pytest.mark.
        const pythonPattern = /(?:^|\s)def\s+test\w*\(|@pytest\.mark\./gm;
        const pythonMatches = content.match(pythonPattern);
        return Math.max(1, pythonMatches ? pythonMatches.length : 1);

      case 'go':
        // Count test functions: func Test, func Benchmark, func Fuzz
        const goPattern = /func\s+(Test|Benchmark|Fuzz)\w+\s*\(/gm;
        const goMatches = content.match(goPattern);
        return Math.max(1, goMatches ? goMatches.length : 1);

      default:
        // Default: assume 1 test per file
        return 1;
    }
  } catch {
    return 1;
  }
}

/**
 * Detects language from file extension
 */
function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'scala':
      return 'scala';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    default:
      return 'unknown';
  }
}

/**
 * Counts total tests in project files
 */
export async function countProjectTests(
  projectPath: string,
  filePatterns: string[]
): Promise<number> {
  const allFiles = new Set<string>();
  const cwd = process.cwd();
  let totalTests = 0;

  if (!isValidPath(projectPath, cwd)) {
    return 0;
  }

  for (const pattern of filePatterns) {
    const fullPattern = join(projectPath, pattern);
    try {
      const files = await glob(fullPattern, {
        ignore: [
          '**/node_modules/**',
          '**/target/**',
          '**/.git/**',
          '**/dist/**',
          '**/build/**',
          '**/.next/**',
          '**/.nuxt/**',
          '**/.svelte-kit/**',
        ],
        absolute: false,
        nodir: true,
        cwd,
      });

      files.forEach((file) => {
        try {
          if (!isValidPath(file, cwd)) {
            return;
          }
          const fullPath = resolve(cwd, file);
          const stats = statSync(fullPath);
          if (stats.isFile() && !allFiles.has(file)) {
            allFiles.add(file);
            const language = detectLanguage(file);
            const testCount = countTestsInFile(file, language);
            totalTests += testCount;
          }
        } catch {
          // Skip files that can't be accessed
        }
      });
    } catch {}
  }

  return totalTests;
}

/**
 * Calculates the optimal number of parallel jobs for a project
 */
export function calculateOptimalJobs(
  count: number,
  itemsPerJob: number,
  minJobs: number,
  maxJobs: number
): number {
  if (count === 0) {
    return minJobs;
  }

  const calculatedJobs = Math.ceil(count / itemsPerJob);

  // Apply min/max constraints
  const jobs = Math.max(minJobs, Math.min(maxJobs, calculatedJobs));

  return jobs;
}

/**
 * Generates matrix entries for all projects with their batches
 */
export function generateMatrix(projectJobs: ProjectJobInfo[]): MatrixEntry[] {
  const matrix: MatrixEntry[] = [];

  for (const projectInfo of projectJobs) {
    for (let batch = 1; batch <= projectInfo.jobCount; batch++) {
      matrix.push({
        project: projectInfo.project,
        batch,
      });
    }
  }

  return matrix;
}

/**
 * Main function to generate optimal CI matrix
 */
export async function run(): Promise<void> {
  try {
    const projectsInput = core.getInput('projects', { required: true });
    const basePathInput = core.getInput('base-path') || '.';
    const mode = core.getInput('mode') || 'file-count';
    const cwd = process.cwd();

    if (basePathInput.length > 512 || !isValidPath(basePathInput, cwd)) {
      throw new Error('Invalid base-path');
    }
    const basePath = basePathInput;
    const filesPerJobInput = core.getInput('files-per-job');
    const testsPerJobInput = core.getInput('tests-per-job');
    const filesPerJob = parseInt(filesPerJobInput || '50', 10);
    const testsPerJob = parseInt(testsPerJobInput || '100', 10);
    const minJobs = parseInt(core.getInput('min-jobs') || '1', 10);
    const maxJobs = parseInt(core.getInput('max-jobs') || '10', 10);
    const filePatternsInput = core.getInput('file-patterns') || '**/*';

    // Validate mode
    if (mode !== 'file-count' && mode !== 'test-count') {
      throw new Error('mode must be either "file-count" or "test-count"');
    }

    if (filesPerJobInput !== '' && testsPerJobInput !== '') {
      if (mode === 'file-count') {
        core.warning(
          'Both files-per-job and tests-per-job were provided. Using files-per-job (test-count mode uses tests-per-job).'
        );
      } else {
        core.warning(
          'Both files-per-job and tests-per-job were provided. Using tests-per-job (file-count mode uses files-per-job).'
        );
      }
    }

    // Validate inputs
    if (isNaN(filesPerJob) || filesPerJob < 1) {
      throw new Error('files-per-job must be a positive integer');
    }
    if (isNaN(testsPerJob) || testsPerJob < 1) {
      throw new Error('tests-per-job must be a positive integer');
    }
    if (isNaN(minJobs) || minJobs < 1) {
      throw new Error('min-jobs must be a positive integer');
    }
    if (isNaN(maxJobs) || maxJobs < 1) {
      throw new Error('max-jobs must be a positive integer');
    }
    if (minJobs > maxJobs) {
      throw new Error('min-jobs cannot be greater than max-jobs');
    }
    if (maxJobs > 100) {
      throw new Error('max-jobs cannot exceed 100');
    }

    let projects: string[];
    try {
      projects = JSON.parse(projectsInput);
      if (!Array.isArray(projects)) {
        throw new Error('projects must be a JSON array');
      }
      if (projects.length === 0) {
        core.warning('No projects provided, returning empty matrix');
        core.setOutput('matrix', JSON.stringify([]));
        return;
      }
      if (projects.length > 100) {
        throw new Error('Too many projects (max 100)');
      }
      for (const project of projects) {
        if (typeof project !== 'string' || project.length === 0 || project.length > 256) {
          throw new Error('Invalid project name');
        }
        if (project.includes('..') || project.includes('/') || project.includes('\\')) {
          throw new Error('Invalid project name');
        }
      }
    } catch (error) {
      throw new Error(
        `Failed to parse projects JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const filePatterns = filePatternsInput
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (filePatterns.length === 0) {
      throw new Error('At least one file pattern must be provided');
    }
    for (const pattern of filePatterns) {
      if (pattern.length > 512) {
        throw new Error('File pattern too long');
      }
    }

    core.info(`Analyzing ${projects.length} project(s) for optimal job splitting`);
    core.info(`Base path: ${basePath}`);
    core.info(`Mode: ${mode}`);
    if (mode === 'file-count') {
      core.info(`Target files per job: ${filesPerJob}`);
    } else {
      core.info(`Target tests per job: ${testsPerJob}`);
    }
    core.info(`Job range: ${minJobs}-${maxJobs} per project`);
    core.info(`File patterns: ${filePatterns.join(', ')}`);

    // Analyze each project
    const projectJobs: ProjectJobInfo[] = [];

    for (const project of projects) {
      const projectPath = join(basePath, project);
      core.info(`\nAnalyzing project: ${project}`);

      const fileCount = await countProjectFiles(projectPath, filePatterns);
      let count: number;
      let itemsPerJob: number;

      if (mode === 'test-count') {
        const testCount = await countProjectTests(projectPath, filePatterns);
        count = testCount;
        itemsPerJob = testsPerJob;
      } else {
        count = fileCount;
        itemsPerJob = filesPerJob;
      }

      const jobCount = calculateOptimalJobs(count, itemsPerJob, minJobs, maxJobs);

      const projectInfo: ProjectJobInfo = {
        project,
        fileCount,
        jobCount,
      };

      if (mode === 'test-count') {
        projectInfo.testCount = count;
      }

      projectJobs.push(projectInfo);

      const itemsPerJobValue = count > 0 ? Math.ceil(count / jobCount) : 0;
      if (mode === 'test-count') {
        core.info(
          `  Files: ${fileCount}, Tests: ${count}, Jobs: ${jobCount} (~${itemsPerJobValue} tests/job)`
        );
      } else {
        core.info(`  Files: ${fileCount}, Jobs: ${jobCount} (~${itemsPerJobValue} files/job)`);
      }
    }

    const matrix = generateMatrix(projectJobs);

    // Output results
    const matrixJson = JSON.stringify(matrix);
    core.setOutput('matrix', matrixJson);

    core.info(`\nGenerated matrix with ${matrix.length} entry/entries:`);
    core.info(`  Projects: ${projects.length}`);
    core.info(`  Total jobs: ${matrix.length}`);
    core.info(`\nMatrix preview:`);
    for (const entry of matrix.slice(0, 10)) {
      core.info(`  - project: ${entry.project}, batch: ${entry.batch}`);
    }
    if (matrix.length > 10) {
      core.info(`  ... and ${matrix.length - 10} more entries`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.setFailed(errorMessage);
  }
}

// This code only runs when executed as a GitHub Action, not during tests
/* v8 ignore next 3 -- @preserve */
if (!process.env.VITEST) {
  void run();
}
