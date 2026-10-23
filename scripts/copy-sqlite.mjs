import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/sqlite", { recursive: true });
copyFileSync("node_modules/sql.js/dist/sql-wasm.wasm", "public/sqlite/sql-wasm.wasm");
