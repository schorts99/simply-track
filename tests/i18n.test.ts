import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { detectLanguage } from "../src/shared/i18n/language";
import { spanish, translate, translateError } from "../src/shared/i18n/messages";
import { expenseCategories, incomeCategories } from "../src/modules/finance/domain/finance";
import { formatMoney } from "../src/shared/presentation/primitives";

describe("language selection", () => {
  it("detects supported device languages in preference order, including regional variants", () => {
    expect(detectLanguage(["es-CR", "en-US"], null)).toBe("es");
    expect(detectLanguage(["EN-gb", "es"], null)).toBe("en");
    expect(detectLanguage(["fr-FR", "es-MX", "en"], null)).toBe("es");
    expect(detectLanguage(["fr"], null)).toBe("en");
    expect(detectLanguage([], null)).toBe("en");
  });
  it("gives a valid saved override precedence, ignores unsupported/corrupted values", () => {
    expect(detectLanguage(["es-CR"], "en")).toBe("en");
    expect(detectLanguage(["en-US"], "es")).toBe("es");
    for (const value of ["fr", "", "ES", "undefined"]) expect(detectLanguage(["es"], value)).toBe("es");
  });
});

describe("translation catalog", () => {
  it("interpolates values literally, leaving unknown technical errors intact", () => {
    expect(translate("es", "Delete {p0}", { p0: "My $& {other} record" })).toBe("Eliminar My $& {other} record");
    expect(translate("en", "{count} records", { count: 2 })).toBe("2 records");
    expect(translate("es", "{count} record", { count: 1 })).toBe("1 registro");
    expect(translate("es", "An unknown browser error")).toBe("An unknown browser error");
    expect(translateError("es", "Title is required (maximum 120 characters).")).toBe("El campo Título es obligatorio (máximo 120 caracteres).");
    expect(translateError("es", "Google Drive request failed (403). Your local vault is unchanged.")).toContain("(403)");
    expect(translateError("es", "Google sign-in failed: no access token")).toBe("Falló el inicio de sesión de Google: sin token de acceso");
    expect(translateError("en", "Google sign-in failed: access_denied")).toBe("Google sign-in failed: access_denied");
  });
  it("preserves all interpolation placeholders in Spanish", () => {
    for (const [english, translated] of Object.entries(spanish)) {
      expect(translated.trim(), english).not.toBe("");
      expect(translated.match(/\{\w+\}/g)?.sort() ?? [], english).toEqual(english.match(/\{\w+\}/g)?.sort() ?? []);
    }
  });
  it("covers static UI messages, labels, categories, payment methods and owned errors", () => {
    const messages = new Set<string>([...expenseCategories, ...incomeCategories, "Card", "Cash", "Bank transfer", "Digital wallet"]);
    for (const folder of ["src/modules/finance/presentation", "src/modules/legal/presentation", "src/shared/presentation", "src/shared/i18n", "src/shared/theme"]) {
      for (const file of readdirSync(folder).filter((file) => file.endsWith(".tsx"))) {
      const source = ts.createSourceFile(file, readFileSync(`${folder}/${file}`, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const walk = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText(source) === "t" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) messages.add(node.arguments[0].text);
        if (ts.isCallExpression(node) && node.expression.getText(source) === "cashField" && node.arguments[1] && ts.isStringLiteral(node.arguments[1])) messages.add(node.arguments[1].text);
        if (ts.isPropertyAssignment(node) && ["title", "subtitle", "label", "short"].includes(node.name.getText(source)) && ts.isStringLiteral(node.initializer) && node.initializer.text) messages.add(node.initializer.text);
        ts.forEachChild(node, walk);
      };
      walk(source);
      }
    }
    for (const folder of ["src/modules/finance/infrastructure", "src/modules/vault/infrastructure", "src/composition", "src/modules/finance/domain"]) {
      for (const file of readdirSync(folder).filter((file) => file.endsWith(".ts"))) {
      const source = ts.createSourceFile(file, readFileSync(`${folder}/${file}`, "utf8"), ts.ScriptTarget.Latest, true);
      const walk = (node: ts.Node) => {
        if (ts.isNewExpression(node) && node.expression.getText(source) === "Error" && node.arguments?.[0] && ts.isStringLiteral(node.arguments[0])) messages.add(node.arguments[0].text);
        ts.forEachChild(node, walk);
      };
      walk(source);
      }
    }
    expect([...messages].filter((key) => !Object.hasOwn(spanish, key))).toEqual([]);
  });
  it("formats currency using the chosen language rather than the device default", () => {
    expect(formatMoney(123456, "USD", "en")).toBe(new Intl.NumberFormat("en", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(1234.56));
    expect(formatMoney(123456, "USD", "es")).toBe(new Intl.NumberFormat("es", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(1234.56));
    expect(formatMoney(123456, "USD", "es")).not.toBe(formatMoney(123456, "USD", "en"));
  });
});
