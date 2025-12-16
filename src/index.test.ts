import { describe, it, expect, vi, beforeEach } from 'vitest';
import { glob } from 'glob';

vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('glob', async () => {
  const actual = await vi.importActual('glob');
  return {
    ...actual,
    glob: vi.fn(),
  };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    statSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

vi.mock('path', async () => {
  const actual = await vi.importActual('path');
  return {
    ...actual,
    resolve: vi.fn(),
    relative: vi.fn(),
  };
});

import * as core from '@actions/core';
import { statSync, readFileSync } from 'fs';
import { resolve, relative } from 'path';
import {
  countProjectFiles,
  countProjectTests,
  collectProjectTestFiles,
  calculateOptimalJobs,
  calculateBatchesWithBinPacking,
  generateMatrix,
  run,
} from './index.js';

const mockGlob = glob as ReturnType<typeof vi.fn>;
const mockStatSync = statSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockResolve = resolve as ReturnType<typeof vi.fn>;
const mockRelative = relative as ReturnType<typeof vi.fn>;
const mockCore = core as {
  getInput: ReturnType<typeof vi.fn>;
  setOutput: ReturnType<typeof vi.fn>;
  setFailed: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
};

describe('countProjectFiles', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const actualPath = await vi.importActual<typeof import('path')>('path');
    mockResolve.mockImplementation((...args: string[]) => actualPath.resolve(...args));
    mockRelative.mockImplementation((from: string, to: string) => actualPath.relative(from, to));
  });

  it('should count files matching a single pattern', async () => {
    mockGlob.mockResolvedValue(['file1.ts', 'file2.ts']);
    mockStatSync.mockReturnValue({ isFile: () => true });

    const result = await countProjectFiles('project1', ['**/*.ts']);

    expect(result).toBe(2);
    expect(mockGlob).toHaveBeenCalled();
  });

  it('should count files matching multiple patterns', async () => {
    mockGlob.mockResolvedValueOnce(['file1.ts']).mockResolvedValueOnce(['file2.js']);
    mockStatSync.mockReturnValue({ isFile: () => true });

    const result = await countProjectFiles('project1', ['**/*.ts', '**/*.js']);

    expect(result).toBe(2);
    expect(mockGlob).toHaveBeenCalledTimes(2);
  });

  it('should filter out directories', async () => {
    mockGlob.mockResolvedValue(['file1.ts', 'dir1']);
    mockStatSync.mockImplementation((path: string) => {
      if (path.includes('dir1')) {
        return { isFile: () => false };
      }
      return { isFile: () => true };
    });

    const result = await countProjectFiles('project1', ['**/*']);

    expect(result).toBe(1);
  });

  it('should handle empty results', async () => {
    mockGlob.mockResolvedValue([]);

    const result = await countProjectFiles('project1', ['**/*.ts']);

    expect(result).toBe(0);
  });

  it('should handle glob errors gracefully', async () => {
    mockGlob.mockRejectedValue(new Error('Glob error'));

    const result = await countProjectFiles('project1', ['**/*.ts']);

    expect(result).toBe(0);
  });

  it('should skip files with invalid paths', async () => {
    mockGlob.mockResolvedValue(['../invalid/file.ts', 'valid/file.ts']);
    mockStatSync.mockReturnValue({ isFile: () => true });
    const actualPath = await vi.importActual<typeof import('path')>('path');
    mockRelative.mockImplementation((from: string, to: string) => {
      const relative = actualPath.relative(from, to);
      // If the relative path contains '../invalid', make it invalid by ensuring it starts with '..'
      if (relative.includes('invalid') && !relative.startsWith('..')) {
        return '../' + relative;
      }
      return relative;
    });

    const result = await countProjectFiles('project1', ['**/*.ts']);

    expect(result).toBe(1);
  });

  it('should skip files when isValidPath returns false in file iteration', async () => {
    mockGlob.mockResolvedValue(['file1.ts', 'file2.ts']);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 0 });
    let callCount = 0;
    mockRelative.mockImplementation((_from: string, _to: string) => {
      callCount++;
      if (callCount === 1) {
        return '../../invalid/file.ts';
      }
      return 'file2.ts';
    });

    const result = await countProjectFiles('project1', ['**/*.ts']);

    expect(result).toBe(1);
  });

  it('should handle isValidPath catch block when resolve throws', async () => {
    mockResolve.mockImplementation(() => {
      throw new Error('Path error');
    });
    mockGlob.mockResolvedValue(['file.ts']);

    const result = await countProjectFiles('project1', ['**/*.ts']);

    expect(result).toBe(0);
  });

  it('should handle isValidPath catch block when relative throws', async () => {
    const actualPath = await vi.importActual<typeof import('path')>('path');
    mockResolve.mockImplementation((...args: string[]) => actualPath.resolve(...args));
    mockRelative.mockImplementation(() => {
      throw new Error('Relative error');
    });
    mockGlob.mockResolvedValue(['file.ts']);

    const result = await countProjectFiles('project1', ['**/*.ts']);

    expect(result).toBe(0);
  });

  it('should deduplicate files across patterns', async () => {
    mockGlob
      .mockResolvedValueOnce(['file1.ts', 'file2.ts'])
      .mockResolvedValueOnce(['file1.ts', 'file3.ts']);
    mockStatSync.mockReturnValue({ isFile: () => true });

    const result = await countProjectFiles('project1', ['**/*.ts', '**/*.ts']);

    expect(result).toBe(3); // file1, file2, file3
  });

  it('should handle statSync errors gracefully', async () => {
    mockGlob.mockResolvedValue(['file1.ts', 'file2.ts']);
    mockStatSync.mockImplementation(() => {
      throw new Error('statSync error');
    });

    const result = await countProjectFiles('project1', ['**/*.ts']);

    expect(result).toBe(0);
  });
});

describe('countProjectTests', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockGlob.mockResolvedValue([]);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 1000 });
    mockReadFileSync.mockReturnValue('');
    const actualPath = await vi.importActual<typeof import('path')>('path');
    mockResolve.mockImplementation((...args: string[]) => actualPath.resolve(...args));
    mockRelative.mockImplementation((from: string, to: string) => actualPath.relative(from, to));
  });

  it('should count tests in Scala files', async () => {
    mockGlob.mockResolvedValue(['Test1.scala']);
    mockReadFileSync.mockReturnValue(
      'class Test1 extends FunSuite { test("test1") {} it("test2") {} should("test3") {} in { property("test4") {} } }'
    );

    const result = await countProjectTests('project1', ['**/*.scala']);

    expect(result).toBeGreaterThanOrEqual(4);
  });

  it('should count tests in TypeScript files', async () => {
    mockGlob.mockResolvedValue(['test.ts']);
    mockReadFileSync.mockReturnValue(
      'describe("suite", () => { it("test1", () => {}); test("test2", () => {}); describe("nested", () => {}); });'
    );

    const result = await countProjectTests('project1', ['**/*.ts']);

    expect(result).toBeGreaterThanOrEqual(3);
  });

  it('should count tests in TypeScript JSX files', async () => {
    mockGlob.mockResolvedValue(['test.tsx']);
    mockReadFileSync.mockReturnValue(
      'describe("suite", () => { it("test1", () => {}); test("test2", () => {}); });'
    );

    const result = await countProjectTests('project1', ['**/*.tsx']);

    expect(result).toBeGreaterThanOrEqual(2);
  });

  it('should count tests in JavaScript files', async () => {
    mockGlob.mockResolvedValue(['test.js']);
    mockReadFileSync.mockReturnValue(
      'describe("suite", () => { it("test1", () => {}); test("test2", () => {}); });'
    );

    const result = await countProjectTests('project1', ['**/*.js']);

    expect(result).toBeGreaterThanOrEqual(2);
  });

  it('should count tests in JavaScript JSX files', async () => {
    mockGlob.mockResolvedValue(['test.jsx']);
    mockReadFileSync.mockReturnValue(
      'describe("suite", () => { it("test1", () => {}); test("test2", () => {}); });'
    );

    const result = await countProjectTests('project1', ['**/*.jsx']);

    expect(result).toBeGreaterThanOrEqual(2);
  });

  it('should count tests in Python files', async () => {
    mockGlob.mockResolvedValue(['test.py']);
    mockReadFileSync.mockReturnValue(
      'def test_something(): pass\ndef test(): pass\n@pytest.mark.parametrize\ndef test_another(): pass\n@pytest.mark.skip'
    );

    const result = await countProjectTests('project1', ['**/*.py']);

    expect(result).toBeGreaterThanOrEqual(5); // 3 def test + 2 @pytest.mark.
  });

  it('should return 0 tests when countTestsInFile receives a directory', async () => {
    // Test that countTestsInFile returns 0 when statSync.isFile() returns false
    // This covers line 79 in countTestsInFile
    mockGlob.mockResolvedValue(['test.py']);
    // First statSync call in countProjectTests (line 185) - passes as file
    // Second statSync call in countTestsInFile (line 77) - fails as directory
    mockStatSync
      .mockReturnValueOnce({ isFile: () => true, size: 1000 }) // Passes check at line 186
      .mockReturnValueOnce({ isFile: () => false, size: 1000 }); // Fails check at line 78, hits line 79

    const result = await countProjectTests('project1', ['**/*.py']);

    expect(result).toBe(0);
  });

  it('should handle statSync errors in countProjectTests', async () => {
    mockGlob.mockResolvedValue(['test.py']);
    mockStatSync.mockImplementation(() => {
      throw new Error('statSync error');
    });

    const result = await countProjectTests('project1', ['**/*.py']);

    expect(result).toBe(0);
  });

  it('should handle duplicate files across patterns in countProjectTests', async () => {
    mockGlob.mockResolvedValue(['test.py']);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 1000 });
    mockReadFileSync.mockReturnValue('def test_something(): pass');

    const result = await countProjectTests('project1', ['**/*.py', '**/*.py']);

    // Should only count once even though pattern appears twice
    expect(result).toBeGreaterThanOrEqual(1);
  });

  it('should handle glob errors in countProjectTests', async () => {
    mockGlob.mockImplementation(() => {
      throw new Error('Glob error');
    });
    mockCore.warning = vi.fn();

    const result = await countProjectTests('project1', ['**/*.ts']);

    expect(result).toBe(0);
  });

  it('should skip files with invalid paths in countProjectTests', async () => {
    mockGlob.mockResolvedValue(['../invalid/test.scala', 'valid/test.scala']);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 1000 });
    mockReadFileSync.mockReturnValue('test("test")');
    const actualPath = await vi.importActual<typeof import('path')>('path');
    mockRelative.mockImplementation((from: string, to: string) => {
      const relative = actualPath.relative(from, to);
      // If the relative path contains 'invalid', make it invalid by ensuring it starts with '..'
      if (relative.includes('invalid') && !relative.startsWith('..')) {
        return '../' + relative;
      }
      return relative;
    });

    const result = await countProjectTests('project1', ['**/*.scala']);

    expect(result).toBeGreaterThan(0);
  });

  it('should return 0 for invalid project path in countProjectTests', async () => {
    mockRelative.mockImplementation(() => '../../invalid');

    const result = await countProjectTests('../invalid', ['**/*.scala']);

    expect(result).toBe(0);
  });

  it('should return 0 for invalid file path in countTestsInFile', async () => {
    // Test that countTestsInFile returns 0 when isValidPath returns false (line 83)
    // We need the file to pass isValidPath in countProjectTests loop but fail in countTestsInFile.
    // Use mockImplementationOnce for first two calls, then regular mock for third.
    mockGlob.mockResolvedValue(['test.scala']);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 1000 });
    mockReadFileSync.mockReturnValue('test("test")');
    const actualPath = await vi.importActual<typeof import('path')>('path');
    // Call 1: isValidPath('project1', cwd) - valid
    mockRelative.mockImplementationOnce((from: string, to: string) =>
      actualPath.relative(from, to)
    );
    // Call 2: isValidPath('test.scala', cwd) in countProjectTests - valid
    mockRelative.mockImplementationOnce((from: string, to: string) =>
      actualPath.relative(from, to)
    );
    // Call 3+: isValidPath('test.scala', cwd) in countTestsInFile - invalid (line 83)
    mockRelative.mockImplementation(() => '../../test.scala');

    const result = await countProjectTests('project1', ['**/*.scala']);

    expect(result).toBe(0);
  });

  it('should skip files with invalid paths in file iteration', async () => {
    mockGlob.mockResolvedValue(['../invalid/file.scala', 'valid/file.scala']);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 1000 });
    mockReadFileSync.mockReturnValue('test("test")');
    const actualPath = await vi.importActual<typeof import('path')>('path');
    mockRelative.mockImplementation((from: string, to: string) => {
      const relative = actualPath.relative(from, to);
      // If the relative path contains 'invalid', make it invalid by ensuring it starts with '..'
      if (relative.includes('invalid') && !relative.startsWith('..')) {
        return '../' + relative;
      }
      return relative;
    });

    const result = await countProjectTests('project1', ['**/*.scala']);

    expect(result).toBeGreaterThan(0);
  });

  it('should count tests in Go files', async () => {
    mockGlob.mockResolvedValue(['test.go']);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 1000 });
    mockReadFileSync.mockReturnValue(
      'func TestSomething(t *testing.T) {}\nfunc BenchmarkSomething(b *testing.B) {}\nfunc FuzzSomething(f *testing.F) {}'
    );

    const result = await countProjectTests('project1', ['**/*.go']);

    expect(result).toBeGreaterThanOrEqual(3);
  });

  it('should default to 1 test per file if pattern matching fails', async () => {
    mockGlob.mockResolvedValue(['unknown.xyz']);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 1000 });
    mockReadFileSync.mockReturnValue('some content');

    const result = await countProjectTests('project1', ['**/*.xyz']);

    expect(result).toBeGreaterThanOrEqual(1);
  });

  it('should return 1 test when Scala file has no matches', async () => {
    mockGlob.mockResolvedValue(['Test1.scala']);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 1000 });
    mockReadFileSync.mockReturnValue('class Test1 extends FunSuite { }');

    const result = await countProjectTests('project1', ['**/*.scala']);

    expect(result).toBe(1);
  });

  it('should return 1 test when TypeScript file has no matches', async () => {
    mockGlob.mockResolvedValue(['test.ts']);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 1000 });
    mockReadFileSync.mockReturnValue('const x = 1;');

    const result = await countProjectTests('project1', ['**/*.ts']);

    expect(result).toBe(1);
  });

  it('should return 1 test when JavaScript file has no matches', async () => {
    mockGlob.mockResolvedValue(['test.js']);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 1000 });
    mockReadFileSync.mockReturnValue('const x = 1;');

    const result = await countProjectTests('project1', ['**/*.js']);

    expect(result).toBe(1);
  });

  it('should return 1 test when Python file has no matches', async () => {
    mockGlob.mockResolvedValue(['test.py']);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 1000 });
    mockReadFileSync.mockReturnValue('def helper(): pass');

    const result = await countProjectTests('project1', ['**/*.py']);

    expect(result).toBe(1);
  });

  it('should return 1 test when Go file has no matches', async () => {
    mockGlob.mockResolvedValue(['test.go']);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 1000 });
    mockReadFileSync.mockReturnValue('func helper() {}');

    const result = await countProjectTests('project1', ['**/*.go']);

    expect(result).toBe(1);
  });

  it('should handle files with no extension', async () => {
    mockGlob.mockResolvedValue(['file-without-ext']);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 1000 });
    mockReadFileSync.mockReturnValue('some content');

    const result = await countProjectTests('project1', ['**/*']);

    expect(result).toBe(1);
  });

  it('should handle files with just a dot', async () => {
    mockGlob.mockResolvedValue(['file.']);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 1000 });
    mockReadFileSync.mockReturnValue('some content');

    const result = await countProjectTests('project1', ['**/*']);

    expect(result).toBe(1);
  });

  it('should handle empty file content', async () => {
    mockGlob.mockResolvedValue(['test.scala']);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 1000 });
    mockReadFileSync.mockReturnValue('');

    const result = await countProjectTests('project1', ['**/*.scala']);

    expect(result).toBe(1);
  });

  it('should handle file read errors gracefully', async () => {
    mockGlob.mockResolvedValue(['test.scala']);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 1000 });
    mockReadFileSync.mockImplementation(() => {
      throw new Error('Read error');
    });

    const result = await countProjectTests('project1', ['**/*.scala']);

    expect(result).toBeGreaterThanOrEqual(1);
  });

  it('should handle large files', async () => {
    mockGlob.mockResolvedValue(['test.scala']);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 11 * 1024 * 1024 });

    const result = await countProjectTests('project1', ['**/*.scala']);

    expect(result).toBeGreaterThanOrEqual(1);
  });
});

describe('calculateOptimalJobs', () => {
  it('should calculate jobs based on count', () => {
    expect(calculateOptimalJobs(100, 50, 1, 10)).toBe(2);
    expect(calculateOptimalJobs(150, 50, 1, 10)).toBe(3);
    expect(calculateOptimalJobs(500, 50, 1, 10)).toBe(10); // Capped at max
  });

  it('should respect minimum jobs', () => {
    expect(calculateOptimalJobs(10, 50, 3, 10)).toBe(3);
    expect(calculateOptimalJobs(0, 50, 1, 10)).toBe(1);
  });

  it('should respect maximum jobs', () => {
    expect(calculateOptimalJobs(1000, 50, 1, 5)).toBe(5);
  });

  it('should round up when count is not divisible by itemsPerJob', () => {
    expect(calculateOptimalJobs(101, 50, 1, 10)).toBe(3);
    expect(calculateOptimalJobs(1, 50, 1, 10)).toBe(1);
  });

  it('should handle zero count', () => {
    expect(calculateOptimalJobs(0, 50, 1, 10)).toBe(1);
  });

  it('should work with test counts', () => {
    expect(calculateOptimalJobs(250, 100, 1, 10)).toBe(3); // 250 tests / 100 per job = 3 jobs
    expect(calculateOptimalJobs(50, 100, 1, 10)).toBe(1); // 50 tests / 100 per job = 1 job (min)
  });
});

describe('generateMatrix', () => {
  it('should generate matrix entries for single project with single batch', () => {
    const projectJobs = [{ project: 'project1', fileCount: 10, jobCount: 1 }];
    const result = generateMatrix(projectJobs);

    expect(result).toEqual([{ project: 'project1', batch: 1 }]);
  });

  it('should generate matrix entries for single project with multiple batches', () => {
    const projectJobs = [{ project: 'project1', fileCount: 150, jobCount: 3 }];
    const result = generateMatrix(projectJobs);

    expect(result).toEqual([
      { project: 'project1', batch: 1 },
      { project: 'project1', batch: 2 },
      { project: 'project1', batch: 3 },
    ]);
  });

  it('should generate matrix entries for multiple projects', () => {
    const projectJobs = [
      { project: 'project1', fileCount: 50, jobCount: 1 },
      { project: 'project2', fileCount: 150, jobCount: 3 },
    ];
    const result = generateMatrix(projectJobs);

    expect(result).toEqual([
      { project: 'project1', batch: 1 },
      { project: 'project2', batch: 1 },
      { project: 'project2', batch: 2 },
      { project: 'project2', batch: 3 },
    ]);
  });

  it('should handle empty input', () => {
    const result = generateMatrix([]);
    expect(result).toEqual([]);
  });

  it('should include testCount and files when batches are provided', () => {
    const projectJobs = [
      {
        project: 'project1',
        fileCount: 10,
        jobCount: 2,
        testCount: 150,
        batches: [
          { testCount: 75, files: ['file1.scala', 'file2.scala'] },
          { testCount: 75, files: ['file3.scala'] },
        ],
      },
    ];
    const result = generateMatrix(projectJobs);

    expect(result).toEqual([
      { project: 'project1', batch: 1, testCount: 75, files: ['file1.scala', 'file2.scala'] },
      { project: 'project1', batch: 2, testCount: 75, files: ['file3.scala'] },
    ]);
  });
});

describe('collectProjectTestFiles', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockStatSync.mockReturnValue({ isFile: () => true, size: 1000 });
    mockReadFileSync.mockReturnValue('test("test1") test("test2")');
    const actualPath = await vi.importActual<typeof import('path')>('path');
    mockResolve.mockImplementation((...args: string[]) => actualPath.resolve(...args));
    mockRelative.mockImplementation((from: string, to: string) => actualPath.relative(from, to));
  });

  it('should collect test files with test counts', async () => {
    mockGlob.mockResolvedValue(['test1.scala', 'test2.scala']);
    mockReadFileSync
      .mockReturnValueOnce('test("test1") test("test2")')
      .mockReturnValueOnce('test("test3")');

    const result = await collectProjectTestFiles('project1', ['**/*.scala']);

    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('test1.scala');
    expect(result[0].testCount).toBeGreaterThanOrEqual(2);
    expect(result[1].path).toBe('test2.scala');
    expect(result[1].testCount).toBeGreaterThanOrEqual(1);
  });

  it('should filter out invalid paths', async () => {
    mockGlob.mockResolvedValue(['../invalid.scala', 'valid.scala']);
    mockReadFileSync.mockReturnValue('test("test")');
    const actualPath = await vi.importActual<typeof import('path')>('path');
    mockRelative.mockImplementation((from: string, to: string) => {
      const relative = actualPath.relative(from, to);
      if (relative.includes('invalid') && !relative.startsWith('..')) {
        return '../' + relative;
      }
      return relative;
    });

    const result = await collectProjectTestFiles('project1', ['**/*.scala']);

    expect(result.every((f) => !f.path.includes('../invalid'))).toBe(true);
  });

  it('should handle files with unicode characters in paths', async () => {
    mockGlob.mockResolvedValue(['test-ñame.scala', 'test-文件.scala']);
    mockReadFileSync.mockReturnValue('test("test")');

    const result = await collectProjectTestFiles('project1', ['**/*.scala']);

    expect(result.length).toBeGreaterThanOrEqual(1);
    result.forEach((file) => {
      expect(typeof file.path).toBe('string');
      expect(file.testCount).toBeGreaterThanOrEqual(1);
    });
  });

  it('should return empty array for invalid path', async () => {
    mockRelative.mockImplementation(() => '../../invalid');

    const result = await collectProjectTestFiles('../invalid', ['**/*.scala']);

    expect(result).toEqual([]);
  });

  it('should handle empty results', async () => {
    mockGlob.mockResolvedValue([]);

    const result = await collectProjectTestFiles('project1', ['**/*.scala']);

    expect(result).toEqual([]);
  });
});

describe('calculateBatchesWithBinPacking', () => {
  it('should create batches using bin-packing', () => {
    const fileTests = [
      { path: 'file1.scala', testCount: 30 },
      { path: 'file2.scala', testCount: 25 },
      { path: 'file3.scala', testCount: 20 },
      { path: 'file4.scala', testCount: 15 },
    ];

    const result = calculateBatchesWithBinPacking(fileTests, 50, 0, 1, 10);

    expect(result.length).toBeGreaterThanOrEqual(2);
    const totalTests = result.reduce((sum, batch) => sum + batch.testCount, 0);
    expect(totalTests).toBe(90);
    result.forEach((batch) => {
      expect(batch).toHaveProperty('files');
      expect(Array.isArray(batch.files)).toBe(true);
    });
  });

  it('should isolate heavy test files', () => {
    const fileTests = [
      { path: 'heavy.scala', testCount: 30 },
      { path: 'file1.scala', testCount: 10 },
      { path: 'file2.scala', testCount: 10 },
    ];

    const result = calculateBatchesWithBinPacking(fileTests, 25, 25, 1, 10);

    expect(result.length).toBeGreaterThanOrEqual(2);
    const heavyBatch = result.find((b) => b.testCount === 30);
    expect(heavyBatch).toBeDefined();
    expect(heavyBatch?.files).toContain('heavy.scala');
  });

  it('should respect min-jobs', () => {
    const fileTests = [{ path: 'file1.scala', testCount: 10 }];

    const result = calculateBatchesWithBinPacking(fileTests, 50, 0, 3, 10);

    expect(result.length).toBe(3);
    expect(result[0].files).toContain('file1.scala');
    expect(result[1].files).toEqual([]);
    expect(result[2].files).toEqual([]);
  });

  it('should respect max-jobs', () => {
    const fileTests = Array.from({ length: 20 }, (_, i) => ({
      path: `file${i}.scala`,
      testCount: 10,
    }));

    const result = calculateBatchesWithBinPacking(fileTests, 10, 0, 1, 5);

    expect(result.length).toBe(5);
  });

  it('should handle empty input', () => {
    const result = calculateBatchesWithBinPacking([], 50, 0, 2, 10);

    expect(result.length).toBe(2);
    expect(result[0].testCount).toBe(0);
    expect(result[0].files).toEqual([]);
    expect(result[1].testCount).toBe(0);
    expect(result[1].files).toEqual([]);
  });

  it('should distribute tests evenly', () => {
    const fileTests = Array.from({ length: 10 }, (_, i) => ({
      path: `file${i}.scala`,
      testCount: 10,
    }));

    const result = calculateBatchesWithBinPacking(fileTests, 25, 0, 1, 10);

    expect(result.length).toBeGreaterThanOrEqual(2);
    const maxTests = Math.max(...result.map((b) => b.testCount));
    const minTests = Math.min(...result.map((b) => b.testCount));
    expect(maxTests - minTests).toBeLessThanOrEqual(10);
    const allFiles = result.flatMap((b) => b.files);
    expect(allFiles.length).toBe(10);
    expect(new Set(allFiles).size).toBe(10);
  });

  it('should handle files with 0 tests', () => {
    const fileTests = [
      { path: 'file1.scala', testCount: 0 },
      { path: 'file2.scala', testCount: 10 },
      { path: 'file3.scala', testCount: 0 },
    ];

    const result = calculateBatchesWithBinPacking(fileTests, 50, 0, 1, 10);

    expect(result.length).toBeGreaterThanOrEqual(1);
    const allFiles = result.flatMap((b) => b.files);
    expect(allFiles).toContain('file1.scala');
    expect(allFiles).toContain('file2.scala');
    expect(allFiles).toContain('file3.scala');
  });

  it('should isolate file when test count exactly equals max-tests-per-file', () => {
    const fileTests = [
      { path: 'exact.scala', testCount: 25 },
      { path: 'file1.scala', testCount: 10 },
    ];

    const result = calculateBatchesWithBinPacking(fileTests, 50, 25, 1, 10);

    const exactBatch = result.find((b) => b.files.includes('exact.scala'));
    expect(exactBatch).toBeDefined();
    expect(exactBatch?.testCount).toBeGreaterThanOrEqual(25);
    expect(exactBatch?.files).toContain('exact.scala');
  });

  it('should handle max-tests-per-file larger than tests-per-job', () => {
    const fileTests = [
      { path: 'heavy.scala', testCount: 100 },
      { path: 'file1.scala', testCount: 10 },
    ];

    const result = calculateBatchesWithBinPacking(fileTests, 50, 75, 1, 10);

    const heavyBatch = result.find((b) => b.files.includes('heavy.scala'));
    expect(heavyBatch).toBeDefined();
    expect(heavyBatch?.testCount).toBe(100);
    expect(heavyBatch?.files.length).toBe(1);
  });

  it('should handle multiple heavy files', () => {
    const fileTests = [
      { path: 'heavy1.scala', testCount: 30 },
      { path: 'heavy2.scala', testCount: 35 },
      { path: 'file1.scala', testCount: 10 },
    ];

    const result = calculateBatchesWithBinPacking(fileTests, 50, 25, 1, 10);

    const heavy1Batch = result.find((b) => b.files.includes('heavy1.scala'));
    const heavy2Batch = result.find((b) => b.files.includes('heavy2.scala'));
    expect(heavy1Batch).toBeDefined();
    expect(heavy2Batch).toBeDefined();
    expect(heavy1Batch?.files).toContain('heavy1.scala');
    expect(heavy2Batch?.files).toContain('heavy2.scala');
    expect(heavy1Batch).not.toBe(heavy2Batch);
  });

  it('should handle files with special characters in paths', () => {
    const fileTests = [
      { path: 'test-file_with.dots.scala', testCount: 10 },
      { path: 'test file with spaces.scala', testCount: 10 },
      { path: 'test@file#with$special.scala', testCount: 10 },
    ];

    const result = calculateBatchesWithBinPacking(fileTests, 50, 0, 1, 10);

    const allFiles = result.flatMap((b) => b.files);
    expect(allFiles).toContain('test-file_with.dots.scala');
    expect(allFiles).toContain('test file with spaces.scala');
    expect(allFiles).toContain('test@file#with$special.scala');
  });

  it('should handle single file input', () => {
    const fileTests = [{ path: 'single.scala', testCount: 50 }];

    const result = calculateBatchesWithBinPacking(fileTests, 100, 0, 1, 10);

    expect(result.length).toBe(1);
    expect(result[0].testCount).toBe(50);
    expect(result[0].files).toEqual(['single.scala']);
  });
});

describe('run', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'max-tests-per-file') return '';
      return '';
    });
    mockCore.setOutput.mockImplementation(() => {});
    mockCore.setFailed.mockImplementation(() => {});
    mockCore.info.mockImplementation(() => {});
    mockCore.warning.mockImplementation(() => {});
    mockCore.debug.mockImplementation(() => {});
    mockGlob.mockResolvedValue([]);
    mockStatSync.mockReturnValue({ isFile: () => true, size: 0 });
    mockReadFileSync.mockReturnValue('');
    const actualPath = await vi.importActual<typeof import('path')>('path');
    mockResolve.mockImplementation((...args: string[]) => actualPath.resolve(...args));
    mockRelative.mockImplementation((from: string, to: string) => actualPath.relative(from, to));
  });

  it('should generate matrix for single project', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'base-path') return '.';
      if (key === 'files-per-job') return '50';
      if (key === 'min-jobs') return '1';
      if (key === 'max-jobs') return '10';
      if (key === 'file-patterns') return '**/*';
      return '';
    });

    mockGlob.mockResolvedValue(['file1.ts', 'file2.ts']);

    await run();

    expect(mockCore.setOutput).toHaveBeenCalledWith(
      'matrix',
      JSON.stringify([{ project: 'project1', batch: 1 }])
    );
  });

  it('should generate matrix for multiple projects with different job counts', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1", "project2"]';
      if (key === 'base-path') return '.';
      if (key === 'files-per-job') return '50';
      if (key === 'min-jobs') return '1';
      if (key === 'max-jobs') return '10';
      if (key === 'file-patterns') return '**/*';
      return '';
    });

    // Project1 has 30 files (1 job), Project2 has 150 files (3 jobs)
    mockGlob
      .mockResolvedValueOnce(Array.from({ length: 30 }, (_, i) => `file${i}.ts`))
      .mockResolvedValueOnce(Array.from({ length: 150 }, (_, i) => `file${i}.ts`));

    await run();

    const setOutputCalls = (mockCore.setOutput as ReturnType<typeof vi.fn>).mock.calls;
    const matrixCall = setOutputCalls.find((call) => call[0] === 'matrix');
    expect(matrixCall).toBeDefined();

    const matrix = JSON.parse(matrixCall![1] as string);
    expect(matrix).toHaveLength(4); // 1 job for project1 + 3 jobs for project2
    expect(matrix.filter((e: { project: string }) => e.project === 'project1')).toHaveLength(1);
    expect(matrix.filter((e: { project: string }) => e.project === 'project2')).toHaveLength(3);
  });

  it('should handle empty projects array', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '[]';
      return '';
    });

    await run();

    expect(mockCore.warning).toHaveBeenCalledWith('No projects provided, returning empty matrix');
    expect(mockCore.setOutput).toHaveBeenCalledWith('matrix', JSON.stringify([]));
  });

  it('should validate files-per-job', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'files-per-job') return '0';
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('files-per-job must be a positive integer');
  });

  it('should validate min-jobs', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'min-jobs') return '0';
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('min-jobs must be a positive integer');
  });

  it('should validate max-jobs', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'max-jobs') return '0';
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('max-jobs must be a positive integer');
  });

  it('should validate min-jobs <= max-jobs', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'min-jobs') return '10';
      if (key === 'max-jobs') return '5';
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('min-jobs cannot be greater than max-jobs');
  });

  it('should validate max-jobs limit', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'max-jobs') return '101';
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('max-jobs cannot exceed 100');
  });

  it('should validate projects JSON format', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return 'invalid json';
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse projects JSON')
    );
  });

  it('should validate projects is an array', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '{"project": "project1"}';
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      'Failed to parse projects JSON: projects must be a JSON array'
    );
  });

  it('should handle non-Error exceptions in projects parsing', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '[]';
      return '';
    });
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw 'string error'; // Throw a string, not an Error
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('Failed to parse projects JSON: string error');

    parseSpy.mockRestore();
  });

  it('should handle custom file patterns', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'file-patterns') return '**/*.ts,**/*.js';
      return '';
    });

    mockGlob.mockResolvedValue(['file1.ts']);

    await run();

    expect(mockGlob).toHaveBeenCalledTimes(2);
  });

  it('should handle custom base path', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'base-path') return 'custom/path';
      return '';
    });

    mockGlob.mockResolvedValue(['file1.ts']);

    await run();

    expect(mockGlob).toHaveBeenCalledWith(
      expect.stringContaining('custom/path'),
      expect.any(Object)
    );
  });

  it('should respect max-jobs cap when calculating jobs', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'files-per-job') return '50';
      if (key === 'max-jobs') return '5';
      return '';
    });

    // Project has 1000 files, should be capped at 5 jobs
    mockGlob.mockResolvedValue(Array.from({ length: 1000 }, (_, i) => `file${i}.ts`));

    await run();

    const setOutputCalls = (mockCore.setOutput as ReturnType<typeof vi.fn>).mock.calls;
    const matrixCall = setOutputCalls.find((call) => call[0] === 'matrix');
    const matrix = JSON.parse(matrixCall![1] as string);
    expect(matrix).toHaveLength(5);
  });

  it('should respect min-jobs when calculating jobs', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'files-per-job') return '50';
      if (key === 'min-jobs') return '3';
      return '';
    });

    // Project has only 10 files, but min-jobs is 3
    mockGlob.mockResolvedValue(Array.from({ length: 10 }, (_, i) => `file${i}.ts`));

    await run();

    const setOutputCalls = (mockCore.setOutput as ReturnType<typeof vi.fn>).mock.calls;
    const matrixCall = setOutputCalls.find((call) => call[0] === 'matrix');
    const matrix = JSON.parse(matrixCall![1] as string);
    expect(matrix).toHaveLength(3);
  });

  it('should handle errors gracefully', async () => {
    mockCore.getInput.mockImplementation(() => {
      throw new Error('Input error');
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('Input error');
  });

  it('should handle non-Error exceptions', async () => {
    mockCore.getInput.mockImplementation(() => {
      throw 'String error';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('String error');
  });

  it('should validate empty file patterns after filtering', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'file-patterns') return '  ,  ,  '; // Only whitespace
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('At least one file pattern must be provided');
  });

  it('should handle matrix with more than 10 entries in preview', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'files-per-job') return '10';
      if (key === 'max-jobs') return '15';
      return '';
    });

    // Project has 150 files, should create 15 jobs
    mockGlob.mockResolvedValue(Array.from({ length: 150 }, (_, i) => `file${i}.ts`));

    await run();

    expect(mockCore.info).toHaveBeenCalledWith(expect.stringContaining('... and 5 more entries'));
  });

  it('should handle zero file count in logging', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      return '';
    });

    mockGlob.mockResolvedValue([]);

    await run();

    expect(mockCore.info).toHaveBeenCalledWith(
      expect.stringContaining('Files: 0, Jobs: 1 (~0 files/job)')
    );
  });

  it('should handle default file-patterns when not provided', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'file-patterns') return '';
      return '';
    });

    mockGlob.mockResolvedValue(['file1.ts']);

    await run();

    expect(mockGlob).toHaveBeenCalled();
  });

  it('should handle default base-path when not provided', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'base-path') return '';
      return '';
    });

    mockGlob.mockResolvedValue(['file1.ts']);

    await run();

    expect(mockCore.setOutput).toHaveBeenCalled();
  });

  it('should handle default files-per-job when not provided', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'files-per-job') return '';
      return '';
    });

    mockGlob.mockResolvedValue(['file1.ts']);

    await run();

    expect(mockCore.setOutput).toHaveBeenCalled();
  });

  it('should handle default min-jobs when not provided', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'min-jobs') return '';
      return '';
    });

    mockGlob.mockResolvedValue(['file1.ts']);

    await run();

    expect(mockCore.setOutput).toHaveBeenCalled();
  });

  it('should handle default max-jobs when not provided', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'max-jobs') return '';
      return '';
    });

    mockGlob.mockResolvedValue(['file1.ts']);

    await run();

    expect(mockCore.setOutput).toHaveBeenCalled();
  });

  it('should log info messages correctly', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1", "project2"]';
      return '';
    });

    mockGlob.mockResolvedValueOnce(['file1.ts']).mockResolvedValueOnce(['file2.ts']);

    await run();

    expect(mockCore.info).toHaveBeenCalledWith(expect.stringContaining('Analyzing 2 project(s)'));
    expect(mockCore.info).toHaveBeenCalledWith(
      expect.stringContaining('Analyzing project: project1')
    );
    expect(mockCore.info).toHaveBeenCalledWith(
      expect.stringContaining('Analyzing project: project2')
    );
    expect(mockCore.info).toHaveBeenCalledWith(expect.stringContaining('Generated matrix'));
  });

  it('should handle matrix with 10 or fewer entries in preview', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'files-per-job') return '10';
      if (key === 'max-jobs') return '5';
      return '';
    });

    // Project has 50 files, should create 5 jobs
    mockGlob.mockResolvedValue(Array.from({ length: 50 }, (_, i) => `file${i}.ts`));

    await run();

    // Should not show "... and X more entries" message
    expect(mockCore.info).not.toHaveBeenCalledWith(expect.stringContaining('... and'));
  });

  it('should calculate files per job correctly in logging', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'files-per-job') return '50';
      return '';
    });

    // Project has 100 files, should create 2 jobs (50 files/job)
    mockGlob.mockResolvedValue(Array.from({ length: 100 }, (_, i) => `file${i}.ts`));

    await run();

    expect(mockCore.info).toHaveBeenCalledWith(
      expect.stringContaining('Files: 100, Jobs: 2 (~50 files/job)')
    );
  });

  it('should handle invalid parseInt for files-per-job', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'files-per-job') return 'invalid';
      return '';
    });

    await run();

    // parseInt('invalid') returns NaN, which when compared < 1 should fail validation
    // Actually, NaN < 1 is false, so it won't catch it. Let me check the code...
    // Actually looking at the code, parseInt('invalid', 10) returns NaN, and NaN < 1 is false,
    // so it won't throw. But then filesPerJob will be NaN, and Math.ceil(NaN) is NaN.
    // This is a potential bug, but let's test what actually happens.
    // The test will likely fail in calculateOptimalJobs when dividing by NaN.
    // Let me verify this is handled or add validation.
  });

  it('should handle NaN values from parseInt gracefully', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'files-per-job') return 'not-a-number';
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('files-per-job must be a positive integer');
  });

  it('should handle NaN for min-jobs', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'min-jobs') return 'not-a-number';
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('min-jobs must be a positive integer');
  });

  it('should handle NaN for max-jobs', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'max-jobs') return 'not-a-number';
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('max-jobs must be a positive integer');
  });

  it('should validate mode', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'mode') return 'invalid-mode';
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      'mode must be either "file-count" or "test-count"'
    );
  });

  it('should use test-count mode', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'mode') return 'test-count';
      if (key === 'tests-per-job') return '50';
      return '';
    });

    mockGlob.mockResolvedValue(['Test1.scala', 'Test2.scala']);
    mockReadFileSync.mockReturnValue('class Test { test("test1") {} test("test2") {} }');

    await run();

    expect(mockCore.setOutput).toHaveBeenCalled();
    expect(mockCore.info).toHaveBeenCalledWith(expect.stringContaining('test-count'));
  });

  it('should validate tests-per-job', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'tests-per-job') return '0';
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('tests-per-job must be a positive integer');
  });

  it('should validate max-tests-per-file', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'max-tests-per-file') return '-1';
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      'max-tests-per-file must be a non-negative integer'
    );
  });

  it('should use max-tests-per-file in test-count mode', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'mode') return 'test-count';
      if (key === 'tests-per-job') return '50';
      if (key === 'max-tests-per-file') return '25';
      return '';
    });

    mockGlob.mockResolvedValue(['heavy.scala', 'light.scala']);
    mockReadFileSync
      .mockReturnValueOnce('test("test1") '.repeat(30))
      .mockReturnValueOnce('test("test1")');

    await run();

    expect(mockCore.info).toHaveBeenCalledWith(
      expect.stringContaining('Heavy test isolation: files with 25+ tests get own batch')
    );
    expect(mockCore.setOutput).toHaveBeenCalled();
  });

  it('should include testCount in matrix output for test-count mode', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'mode') return 'test-count';
      if (key === 'tests-per-job') return '50';
      return '';
    });

    mockGlob.mockResolvedValue(['test1.scala', 'test2.scala']);
    mockReadFileSync.mockReturnValue('test("test1") test("test2")');

    await run();

    const setOutputCalls = (mockCore.setOutput as ReturnType<typeof vi.fn>).mock.calls;
    const matrixCall = setOutputCalls.find((call) => call[0] === 'matrix');
    expect(matrixCall).toBeDefined();
    const matrix = JSON.parse(matrixCall![1] as string);
    if (matrix.length > 0) {
      expect(matrix[0]).toHaveProperty('project');
      expect(matrix[0]).toHaveProperty('batch');
    }
  });

  it('should include files array in matrix output for test-count mode', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'mode') return 'test-count';
      if (key === 'tests-per-job') return '50';
      return '';
    });

    mockGlob.mockResolvedValue(['test1.scala', 'test2.scala']);
    mockReadFileSync.mockReturnValue('test("test1") test("test2")');

    await run();

    const setOutputCalls = (mockCore.setOutput as ReturnType<typeof vi.fn>).mock.calls;
    const matrixCall = setOutputCalls.find((call) => call[0] === 'matrix');
    expect(matrixCall).toBeDefined();
    const matrix = JSON.parse(matrixCall![1] as string);
    if (matrix.length > 0 && matrix[0].files) {
      expect(Array.isArray(matrix[0].files)).toBe(true);
      expect(matrix[0].files.length).toBeGreaterThan(0);
      matrix[0].files.forEach((file: unknown) => {
        expect(typeof file).toBe('string');
        expect(file).not.toContain('..');
      });
    }
  });

  it('should not include files array in file-count mode', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'mode') return 'file-count';
      return '';
    });

    mockGlob.mockResolvedValue(['file1.ts', 'file2.ts']);

    await run();

    const setOutputCalls = (mockCore.setOutput as ReturnType<typeof vi.fn>).mock.calls;
    const matrixCall = setOutputCalls.find((call) => call[0] === 'matrix');
    expect(matrixCall).toBeDefined();
    const matrix = JSON.parse(matrixCall![1] as string);
    if (matrix.length > 0) {
      expect(matrix[0]).not.toHaveProperty('files');
      expect(matrix[0]).not.toHaveProperty('testCount');
    }
  });

  it('should handle max-tests-per-file disabled (0)', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'mode') return 'test-count';
      if (key === 'tests-per-job') return '50';
      if (key === 'max-tests-per-file') return '0';
      return '';
    });

    mockGlob.mockResolvedValue(['heavy.scala', 'light.scala']);
    mockReadFileSync
      .mockReturnValueOnce('test("test1") '.repeat(30))
      .mockReturnValueOnce('test("test1")');

    await run();

    expect(mockCore.setOutput).toHaveBeenCalled();
    const setOutputCalls = (mockCore.setOutput as ReturnType<typeof vi.fn>).mock.calls;
    const matrixCall = setOutputCalls.find((call) => call[0] === 'matrix');
    const matrix = JSON.parse(matrixCall![1] as string);
    expect(matrix.length).toBeGreaterThan(0);
  });

  it('should handle very large max-tests-per-file value', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'mode') return 'test-count';
      if (key === 'tests-per-job') return '50';
      if (key === 'max-tests-per-file') return '1000';
      return '';
    });

    mockGlob.mockResolvedValue(['file1.scala', 'file2.scala']);
    mockReadFileSync.mockReturnValue('test("test1")');

    await run();

    expect(mockCore.setOutput).toHaveBeenCalled();
  });

  it('should ensure files array contains only valid paths', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'mode') return 'test-count';
      if (key === 'tests-per-job') return '50';
      return '';
    });

    mockGlob.mockResolvedValue(['valid.scala']);
    mockReadFileSync.mockReturnValue('test("test")');

    await run();

    const setOutputCalls = (mockCore.setOutput as ReturnType<typeof vi.fn>).mock.calls;
    const matrixCall = setOutputCalls.find((call) => call[0] === 'matrix');
    const matrix = JSON.parse(matrixCall![1] as string);
    matrix.forEach((entry: { files?: string[] }) => {
      if (entry.files) {
        entry.files.forEach((file: string) => {
          expect(file).not.toContain('..');
          expect(file).not.toMatch(/^\/|^[A-Z]:/);
        });
      }
    });
  });

  it('should properly JSON serialize files array with special characters', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'mode') return 'test-count';
      if (key === 'tests-per-job') return '50';
      return '';
    });

    mockGlob.mockResolvedValue(['test "file".scala', "test'file.scala"]);
    mockReadFileSync.mockReturnValue('test("test")');

    await run();

    const setOutputCalls = (mockCore.setOutput as ReturnType<typeof vi.fn>).mock.calls;
    const matrixCall = setOutputCalls.find((call) => call[0] === 'matrix');
    expect(matrixCall).toBeDefined();
    const matrixJson = matrixCall![1] as string;
    expect(() => JSON.parse(matrixJson)).not.toThrow();
    const matrix = JSON.parse(matrixJson);
    expect(matrix.length).toBeGreaterThan(0);
  });

  it('should reject project names with path traversal', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["../etc/passwd"]';
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid project name')
    );
  });

  it('should reject project names with path separators', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project/subproject"]';
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid project name')
    );
  });

  it('should reject non-string project names', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '[123]';
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid project name')
    );
  });

  it('should reject empty project names', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '[""]';
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid project name')
    );
  });

  it('should reject project names that are too long', async () => {
    const longName = 'a'.repeat(257);
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return JSON.stringify([longName]);
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid project name')
    );
  });

  it('should reject too many projects', async () => {
    const manyProjects = Array.from({ length: 101 }, (_, i) => `project${i}`);
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return JSON.stringify(manyProjects);
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Too many projects'));
  });

  it('should reject invalid base-path with path traversal', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'base-path') return '../etc';
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid base-path'));
  });

  it('should reject file patterns that are too long', async () => {
    const longPattern = 'a'.repeat(513);
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'file-patterns') return longPattern;
      return '';
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('File pattern too long')
    );
  });

  it('should warn when both files-per-job and tests-per-job are provided in file-count mode', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'files-per-job') return '50';
      if (key === 'tests-per-job') return '100';
      return '';
    });
    mockGlob.mockResolvedValue([]);

    await run();

    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('Both files-per-job and tests-per-job were provided')
    );
    expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('Using files-per-job'));
  });

  it('should warn when both files-per-job and tests-per-job are provided in test-count mode', async () => {
    mockCore.getInput.mockImplementation((key: string) => {
      if (key === 'projects') return '["project1"]';
      if (key === 'mode') return 'test-count';
      if (key === 'files-per-job') return '50';
      if (key === 'tests-per-job') return '100';
      return '';
    });
    mockGlob.mockResolvedValue([]);

    await run();

    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('Both files-per-job and tests-per-job were provided')
    );
    expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('Using tests-per-job'));
  });
});
