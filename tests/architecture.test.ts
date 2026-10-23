import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

function files(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(`${folder}/${entry.name}`) : /\.tsx?$/.test(entry.name) ? [`${folder}/${entry.name}`] : []);
}

describe("vertical slice boundaries", () => {
  it("keeps module domain/application layers independent of presentation, adapters and composition", () => {
    const violations: string[] = [];
    for (const file of files("src/modules").filter((file) => /\/(domain|application|infrastructure)\//.test(file))) {
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      for (const node of source.statements) {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
        const specifier = node.moduleSpecifier.text;
        const target = specifier.startsWith(".") ? relative(resolve("src"), resolve(dirname(file), specifier)) : specifier;
        if (file.includes("/domain/") && /\/(application|infrastructure|presentation)\/|^(composition|shared)\/|^react/.test(target)) violations.push(`${file} -> ${target}`);
        if (file.includes("/application/") && /\/(infrastructure|presentation)\/|^(composition|shared)\/|^react/.test(target)) violations.push(`${file} -> ${target}`);
        if (file.includes("/infrastructure/") && /^composition\//.test(target)) violations.push(`${file} -> ${target}`);
      }
    }
    expect(violations).toEqual([]);
  });
  it("keeps shared UI and browser preferences independent of feature modules", () => {
    for (const file of files("src/shared")) expect(readFileSync(file, "utf8"), file).not.toMatch(/from\s+["'][^"']*(?:modules|composition)\//);
  });
});
