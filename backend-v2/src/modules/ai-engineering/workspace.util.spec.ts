import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { applyApprovedChanges, isPathEligibleForCopyBack } from './workspace.util';

describe('isPathEligibleForCopyBack', () => {
  it('allows a real source file under src/', () => {
    expect(isPathEligibleForCopyBack('src/modules/scanner/scanner.service.ts')).toBe(true);
  });

  it('rejects root config files — present only so tsc/jest resolve, never meant to change', () => {
    expect(isPathEligibleForCopyBack('package.json')).toBe(false);
    expect(isPathEligibleForCopyBack('tsconfig.json')).toBe(false);
    expect(isPathEligibleForCopyBack('.gitignore')).toBe(false);
  });

  it('rejects anything outside src/, even if it sounds source-like', () => {
    expect(isPathEligibleForCopyBack('generated/prisma/client.ts')).toBe(false);
    expect(isPathEligibleForCopyBack('prisma/schema.prisma')).toBe(false);
  });

  it('normalises Windows-style backslash paths before checking', () => {
    expect(isPathEligibleForCopyBack('src\\modules\\scanner\\scanner.service.ts')).toBe(true);
    expect(isPathEligibleForCopyBack('package.json'.replace('/', '\\'))).toBe(false);
  });

  it('allows prisma/schema.prisma only when allowSchema is explicitly opted into', () => {
    expect(isPathEligibleForCopyBack('prisma/schema.prisma', { allowSchema: true })).toBe(true);
    expect(isPathEligibleForCopyBack('prisma/schema.prisma')).toBe(false);
    expect(isPathEligibleForCopyBack('prisma/schema.prisma', { allowSchema: false })).toBe(false);
  });

  it('never allows any other prisma/ path even with allowSchema, only the exact schema file', () => {
    expect(isPathEligibleForCopyBack('prisma/migrations/20240101_x/migration.sql', { allowSchema: true })).toBe(false);
  });
});

describe('applyApprovedChanges', () => {
  let workspaceDir: string;
  let projectDir: string;

  beforeEach(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-eng-test-'));
    workspaceDir = path.join(root, 'workspace');
    projectDir = path.join(root, 'project');
    await fs.mkdir(path.join(workspaceDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'src'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(path.dirname(workspaceDir), { recursive: true, force: true }).catch(() => undefined);
  });

  it('copies an eligible changed src file from the workspace to the real project', async () => {
    await fs.writeFile(path.join(workspaceDir, 'src', 'thing.ts'), 'export const fixed = true;\n', 'utf-8');
    await fs.writeFile(path.join(projectDir, 'src', 'thing.ts'), 'export const fixed = false;\n', 'utf-8');

    const result = await applyApprovedChanges(workspaceDir, projectDir, ['src/thing.ts']);

    expect(result.appliedFiles).toEqual(['src/thing.ts']);
    expect(result.skippedFiles).toEqual([]);
    const content = await fs.readFile(path.join(projectDir, 'src', 'thing.ts'), 'utf-8');
    expect(content).toBe('export const fixed = true;\n');
  });

  it('never applies a change to a root/config file even if it appears in the changed-file list', async () => {
    await fs.writeFile(path.join(workspaceDir, 'package.json'), '{"name":"tampered"}', 'utf-8');
    await fs.writeFile(path.join(projectDir, 'package.json'), '{"name":"real"}', 'utf-8');

    const result = await applyApprovedChanges(workspaceDir, projectDir, ['package.json']);

    expect(result.appliedFiles).toEqual([]);
    expect(result.skippedFiles).toEqual(['package.json']);
    const content = await fs.readFile(path.join(projectDir, 'package.json'), 'utf-8');
    expect(content).toBe('{"name":"real"}');
  });

  it('never deletes a live file, even if the specialist deleted it in its own copy', async () => {
    // No src/gone.ts in the workspace — the specialist removed it there.
    await fs.writeFile(path.join(projectDir, 'src', 'gone.ts'), 'export const stillHere = true;\n', 'utf-8');

    const result = await applyApprovedChanges(workspaceDir, projectDir, ['src/gone.ts']);

    expect(result.appliedFiles).toEqual([]);
    expect(result.skippedFiles).toEqual(['src/gone.ts']);
    const stillExists = await fs
      .access(path.join(projectDir, 'src', 'gone.ts'))
      .then(() => true)
      .catch(() => false);
    expect(stillExists).toBe(true);
  });

  it('creates intermediate directories for a new nested file', async () => {
    await fs.mkdir(path.join(workspaceDir, 'src', 'a', 'b'), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, 'src', 'a', 'b', 'new.ts'), 'export const brandNew = 1;\n', 'utf-8');

    const result = await applyApprovedChanges(workspaceDir, projectDir, ['src/a/b/new.ts']);

    expect(result.appliedFiles).toEqual(['src/a/b/new.ts']);
    const content = await fs.readFile(path.join(projectDir, 'src', 'a', 'b', 'new.ts'), 'utf-8');
    expect(content).toBe('export const brandNew = 1;\n');
  });

  it('copies prisma/schema.prisma back only when allowSchema is passed (touchesSchema tasks)', async () => {
    await fs.mkdir(path.join(workspaceDir, 'prisma'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'prisma'), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, 'prisma', 'schema.prisma'), 'model NewThing {}\n', 'utf-8');
    await fs.writeFile(path.join(projectDir, 'prisma', 'schema.prisma'), '', 'utf-8');

    const withoutFlag = await applyApprovedChanges(workspaceDir, projectDir, ['prisma/schema.prisma']);
    expect(withoutFlag.appliedFiles).toEqual([]);
    expect(withoutFlag.skippedFiles).toEqual(['prisma/schema.prisma']);

    const withFlag = await applyApprovedChanges(workspaceDir, projectDir, ['prisma/schema.prisma'], { allowSchema: true });
    expect(withFlag.appliedFiles).toEqual(['prisma/schema.prisma']);
    const content = await fs.readFile(path.join(projectDir, 'prisma', 'schema.prisma'), 'utf-8');
    expect(content).toBe('model NewThing {}\n');
  });
});
