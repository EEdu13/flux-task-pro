// Gera db/schema.sql com o DDL do schema `gestor` (npm run db:schema). SOMENTE LEITURA no banco.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const sql = require("mssql");
const pool = await sql.connect({ server: process.env.DB_SERVER, database: process.env.DB_DATABASE, user: process.env.DB_USER, password: process.env.DB_PASSWORD, port: Number(process.env.DB_PORT ?? 1433), options: { encrypt: true } });
const q = async (s) => (await pool.request().query(s)).recordset;
const tabelas = await q(`SELECT t.object_id, t.name FROM sys.tables t WHERE t.schema_id = SCHEMA_ID('gestor') ORDER BY t.name`);
const cols = await q(`SELECT c.object_id, c.column_id, c.name, ty.name tipo, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity,
  dc.name df_nome, dc.definition df_def
  FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id
  LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
  WHERE c.object_id IN (SELECT object_id FROM sys.tables WHERE schema_id = SCHEMA_ID('gestor'))
  ORDER BY c.object_id, c.column_id`);
const pks = await q(`SELECT kc.parent_object_id oid, kc.name, kc.type, i.type_desc,
  STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) cols
  FROM sys.key_constraints kc JOIN sys.indexes i ON i.object_id = kc.parent_object_id AND i.index_id = kc.unique_index_id
  JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
  JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
  WHERE OBJECT_SCHEMA_NAME(kc.parent_object_id) = 'gestor'
  GROUP BY kc.parent_object_id, kc.name, kc.type, i.type_desc`);
const fks = await q(`SELECT fk.parent_object_id oid, fk.name, OBJECT_SCHEMA_NAME(fk.referenced_object_id) rs, OBJECT_NAME(fk.referenced_object_id) rt,
  fk.delete_referential_action_desc del,
  STRING_AGG(pc.name, ', ') cols, STRING_AGG(rc.name, ', ') rcols
  FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
  JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
  JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
  WHERE OBJECT_SCHEMA_NAME(fk.parent_object_id) = 'gestor'
  GROUP BY fk.parent_object_id, fk.name, fk.referenced_object_id, fk.delete_referential_action_desc`);
const cks = await q(`SELECT parent_object_id oid, name, definition FROM sys.check_constraints WHERE OBJECT_SCHEMA_NAME(parent_object_id) = 'gestor'`);
const idx = await q(`SELECT i.object_id oid, i.name, i.is_unique, i.type_desc, i.filter_definition filtro,
  STRING_AGG(CASE WHEN ic.is_included_column = 0 THEN c.name + CASE WHEN ic.is_descending_key = 1 THEN ' DESC' ELSE '' END END, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) chaves,
  STRING_AGG(CASE WHEN ic.is_included_column = 1 THEN c.name END, ', ') incl
  FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
  JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
  WHERE OBJECT_SCHEMA_NAME(i.object_id) = 'gestor' AND i.is_primary_key = 0 AND i.is_unique_constraint = 0 AND i.type > 0
  GROUP BY i.object_id, i.name, i.is_unique, i.type_desc, i.filter_definition`);
await pool.close();
const tipo = (c) => {
  const t = c.tipo;
  if (["nvarchar", "nchar"].includes(t)) return `${t.toUpperCase()}(${c.max_length === -1 ? "MAX" : c.max_length / 2})`;
  if (["varchar", "char", "varbinary"].includes(t)) return `${t.toUpperCase()}(${c.max_length === -1 ? "MAX" : c.max_length})`;
  if (["decimal", "numeric"].includes(t)) return `${t.toUpperCase()}(${c.precision},${c.scale})`;
  if (["datetimeoffset", "datetime2", "time"].includes(t)) return `${t.toUpperCase()}(${c.scale})`;
  return t.toUpperCase();
};
let out = `-- Schema \`gestor\` do SGL - CONECTA (flux-task-pro), gerado do banco em ${new Date().toISOString().slice(0, 10)}.
-- Fonte da verdade do que existe no Azure SQL. Ao criar ou alterar uma tabela,
-- atualize este arquivo junto (scripts/exportar-schema.mjs gera de novo).
-- Só o schema \`gestor\` — as tabelas \`dbo.*\` e \`iam.*\` são de outros sistemas.\n\n`;
for (const t of tabelas) {
  const linhas = cols.filter((c) => c.object_id === t.object_id).map((c) =>
    `  ${c.name} ${tipo(c)}${c.is_identity ? " IDENTITY(1,1)" : ""} ${c.is_nullable ? "NULL" : "NOT NULL"}${c.df_def ? ` CONSTRAINT ${c.df_nome} DEFAULT ${c.df_def}` : ""}`);
  for (const k of pks.filter((k) => k.oid === t.object_id))
    linhas.push(`  CONSTRAINT ${k.name} ${k.type === "PK" ? "PRIMARY KEY" : "UNIQUE"} ${k.type_desc === "CLUSTERED" ? "CLUSTERED " : ""}(${k.cols})`);
  for (const f of fks.filter((f) => f.oid === t.object_id))
    linhas.push(`  CONSTRAINT ${f.name} FOREIGN KEY (${f.cols}) REFERENCES ${f.rs}.${f.rt}(${f.rcols})${f.del === "CASCADE" ? " ON DELETE CASCADE" : f.del === "SET_NULL" ? " ON DELETE SET NULL" : ""}`);
  for (const c of cks.filter((c) => c.oid === t.object_id)) linhas.push(`  CONSTRAINT ${c.name} CHECK ${c.definition}`);
  out += `CREATE TABLE gestor.${t.name} (\n${linhas.join(",\n")}\n);\n`;
  for (const i of idx.filter((i) => i.oid === t.object_id))
    out += `CREATE ${i.is_unique ? "UNIQUE " : ""}${i.type_desc === "CLUSTERED" ? "CLUSTERED" : "NONCLUSTERED"} INDEX ${i.name} ON gestor.${t.name} (${i.chaves})${i.incl ? ` INCLUDE (${i.incl})` : ""}${i.filtro ? ` WHERE ${i.filtro}` : ""};\n`;
  out += "\n";
}
fs.writeFileSync("db/schema.sql", out);
console.log(`${tabelas.length} tabelas, ${out.split("\n").length} linhas -> db/schema.sql`);
