import { Pool as PgPool, PoolClient, QueryResult } from "pg";
import { env } from "./env";

export type ResultSetHeader = {
  affectedRows: number;
  changedRows: number;
  insertId: number;
  rowCount: number;
};

const pgPool = new PgPool({
  host: env.dbHost,
  port: env.dbPort,
  user: env.dbUser,
  password: env.dbPassword,
  database: env.dbName,
  max: 10
});

const MYSQL_TO_PG_CONFLICT_TARGET: Record<string, string> = {
  kinerja_kategori_aktivitas: "(nama_kategori)",
  kinerja_satuan: "(nama_satuan)",
  kinerja_evaluasi_tengah_tahun: "(periode_id, pegawai_id)",
  kinerja_evaluasi_akhir_tahun: "(periode_id, pegawai_id)",
  kinerja_kalibrasi_item: "(kalibrasi_id, evaluasi_akhir_id)",
  akun_pengguna: "(username)",
  akun_pengguna_role: "(akun_pengguna_id, role_name)",
  departemen: "(nama)",
  jabatan: "(nama)",
  evaluasi_berakhlak_360: "(penilai_pegawai_id, pegawai_id, tahun_evaluasi, bulan_evaluasi)",
  evaluasi_kinerja: "(pegawai_id, periode_evaluasi_id)",
  indikator_kinerja: "(tim_kerja_id, nama)",
  kegiatan_indikator_kinerja: "(indikator_kinerja_id, nama)"
};

const MYSQL_FORMAT_TO_PG: Record<string, string> = {
  "%Y": "YYYY",
  "%y": "YY",
  "%m": "MM",
  "%c": "MM",
  "%d": "DD",
  "%e": "DD",
  "%H": "HH24",
  "%h": "HH12",
  "%i": "MI",
  "%s": "SS",
  "%S": "SS",
  "%T": "HH24:MI:SS",
  "%M": "Month",
  "%b": "Mon"
};

const normalizeFormat = (format: string) =>
  Object.entries(MYSQL_FORMAT_TO_PG).reduce((result, [mysql, pg]) => result.split(mysql).join(pg), format)
    .replace(/T/g, '"T"');

const splitTopLevel = (value: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;

  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    const prev = i > 0 ? value[i - 1] : "";

    if (quote) {
      current += ch;
      if (ch === quote && prev !== "\\") quote = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch as "'" | '"' | "`";
      current += ch;
      continue;
    }

    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);

    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
};

const replaceFunction = (sql: string, fnName: string, replacer: (args: string[]) => string): string => {
  const lower = sql.toLowerCase();
  const target = `${fnName.toLowerCase()}(`;
  let result = "";
  let cursor = 0;

  while (cursor < sql.length) {
    const start = lower.indexOf(target, cursor);
    if (start < 0) {
      result += sql.slice(cursor);
      break;
    }

    const before = start > 0 ? sql[start - 1] : "";
    if (/[A-Za-z0-9_]/.test(before)) {
      result += sql.slice(cursor, start + target.length);
      cursor = start + target.length;
      continue;
    }

    let depth = 0;
    let quote: "'" | '"' | "`" | null = null;
    let end = -1;

    for (let i = start + fnName.length; i < sql.length; i += 1) {
      const ch = sql[i];
      const prev = i > 0 ? sql[i - 1] : "";

      if (quote) {
        if (ch === quote && prev !== "\\") quote = null;
        continue;
      }

      if (ch === "'" || ch === '"' || ch === "`") {
        quote = ch as "'" | '"' | "`";
        continue;
      }

      if (ch === "(") depth += 1;
      if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end < 0) {
      result += sql.slice(cursor);
      break;
    }

    const rawArgs = sql.slice(start + fnName.length + 1, end);
    result += sql.slice(cursor, start) + replacer(splitTopLevel(rawArgs));
    cursor = end + 1;
  }

  return result;
};

const replaceQuestionPlaceholders = (sql: string): string => {
  let index = 1;
  let result = "";
  let quote: "'" | '"' | "`" | null = null;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const prev = i > 0 ? sql[i - 1] : "";

    if (quote) {
      result += ch;
      if (ch === quote && prev !== "\\") quote = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch as "'" | '"' | "`";
      result += ch;
      continue;
    }

    if (ch === "?") {
      result += `$${index}`;
      index += 1;
      continue;
    }

    result += ch;
  }

  return result;
};

const SQL_KEYWORDS_AFTER_AS = new Set([
  "IDENTITY",
  "INTEGER",
  "INT",
  "CHAR",
  "VARCHAR",
  "TEXT",
  "DECIMAL",
  "NUMERIC",
  "DATE",
  "TIMESTAMP",
  "TIME",
  "BOOLEAN",
  "SMALLINT",
  "BIGINT",
  "DOUBLE",
  "PRECISION",
  "DEFAULT",
  "GENERATED",
  "PRIMARY",
  "KEY",
  "NULL",
  "NOT",
  "CHARACTER",
  "VARYING",
  "COLLATE",
  "CHECK",
  "REFERENCES",
  "CONSTRAINT"
]);

const quoteCamelCaseAliases = (sql: string): string =>
  sql.replace(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\b/g, (match, alias) => {
    const upper = String(alias).toUpperCase();
    if (SQL_KEYWORDS_AFTER_AS.has(upper)) return match;
    return `AS "${alias}"`;
  });

const convertMysqlCastTypes = (sql: string): string =>
  sql
    .replace(/\bAS\s+CHAR\b/gi, "AS TEXT")
    .replace(/\bAS\s+SIGNED\b/gi, "AS INTEGER")
    .replace(/\bAS\s+UNSIGNED\b/gi, "AS INTEGER");

const quoteAliasReferences = (sql: string): string => {
  const aliases = Array.from(sql.matchAll(/\bAS\s+"([A-Za-z_][A-Za-z0-9_]*)"/g))
    .map((match) => match[1])
    .filter((alias) => /[A-Z]/.test(alias));
  if (!aliases.length) return sql;

  return aliases.reduce((current, alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const qualifiedPattern = new RegExp(`\\.${escaped}\\b`, "g");
    const withQualifiedAliases = current.replace(qualifiedPattern, `."${alias}"`);
    const clausePattern = new RegExp(`\\b(ORDER\\s+BY|GROUP\\s+BY)\\s+([\\s\\S]*?)\\b${escaped}\\b`, "gi");
    return withQualifiedAliases.replace(clausePattern, (match) => match.replace(new RegExp(`\\b${escaped}\\b`, "g"), `"${alias}"`));
  }, sql);
};

const normalizeOverQuotedIdentifiers = (sql: string): string => {
  let result = "";
  let cursor = 0;
  let inSingleQuote = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const prev = i > 0 ? sql[i - 1] : "";
    if (ch === "'" && prev !== "\\") {
      if (!inSingleQuote) {
        result += sql.slice(cursor, i).replace(/"{2,}([A-Za-z_][A-Za-z0-9_]*)"{2,}/g, '"$1"');
        cursor = i;
      } else {
        result += sql.slice(cursor, i + 1);
        cursor = i + 1;
      }
      inSingleQuote = !inSingleQuote;
    }
  }

  if (cursor < sql.length) {
    const tail = sql.slice(cursor);
    result += inSingleQuote ? tail : tail.replace(/"{2,}([A-Za-z_][A-Za-z0-9_]*)"{2,}/g, '"$1"');
  }

  return result;
};

const convertInsertIgnore = (sql: string): string => {
  if (!/^\s*INSERT\s+IGNORE\s+INTO\b/i.test(sql)) return sql;
  const normalized = sql.replace(/^\s*INSERT\s+IGNORE\s+INTO\b/i, "INSERT INTO");
  if (/\bON\s+CONFLICT\b/i.test(normalized)) return normalized;
  return `${normalized} ON CONFLICT DO NOTHING`;
};

const convertGroupConcat = (sql: string): string =>
  replaceFunction(sql, "GROUP_CONCAT", (args) => {
    const raw = args.join(", ");
    const distinct = /^\s*DISTINCT\s+/i.test(raw);
    let body = raw.replace(/^\s*DISTINCT\s+/i, "");
    let separator = "','";
    const sepMatch = body.match(/\s+SEPARATOR\s+('(?:[^'\\]|\\.)*')\s*$/i);
    if (sepMatch) {
      separator = sepMatch[1];
      body = body.slice(0, sepMatch.index).trim();
    }
    body = body.replace(/\s+ORDER\s+BY\s+.+$/i, "").trim();
    return `STRING_AGG(${distinct ? "DISTINCT " : ""}(${body})::text, ${separator})`;
  });

const convertOnDuplicateKey = (sql: string): string => {
  if (!/ON\s+DUPLICATE\s+KEY\s+UPDATE/i.test(sql)) return sql;
  const tableMatch = sql.match(/INSERT\s+INTO\s+"?([A-Za-z0-9_]+)"?/i);
  const tableName = tableMatch?.[1] || "";
  const conflictTarget = MYSQL_TO_PG_CONFLICT_TARGET[tableName] || "(id)";
  return sql.replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE\s+([\s\S]*)$/i, (_match, updatePart) => {
    const converted = String(updatePart).replace(/\bVALUES\s*\(\s*([A-Za-z0-9_]+)\s*\)/gi, "EXCLUDED.$1");
    return `ON CONFLICT ${conflictTarget} DO UPDATE SET ${converted}`;
  });
};

const convertMysqlDdl = (sql: string): string => {
  let out = sql;
  out = out.replace(/`/g, "");
  out = out.replace(/\)\s*ENGINE\s*=\s*InnoDB[^;]*/gi, ")");
  out = out.replace(/\bDEFAULT\s+current_timestamp\(\)/gi, "DEFAULT CURRENT_TIMESTAMP");
  out = out.replace(/\s+ON\s+UPDATE\s+CURRENT_TIMESTAMP(?:\(\))?/gi, "");
  out = out.replace(/\s+CHARACTER\s+SET\s+\w+/gi, "");
  out = out.replace(/\s+COLLATE\s+\w+/gi, "");
  out = out.replace(/\bUNSIGNED\b/gi, "");
  out = out.replace(/\bENUM\s*\((?:[^()]|'[^']*')*\)/gi, "VARCHAR(50)");
  out = out.replace(/\bBIGINT(?:\(\d+\))?\s+(?:NOT\s+NULL\s+)?AUTO_INCREMENT\b/gi, "BIGINT GENERATED BY DEFAULT AS IDENTITY");
  out = out.replace(/\bINT(?:\(\d+\))?\s+(?:NOT\s+NULL\s+)?AUTO_INCREMENT\b/gi, "INTEGER GENERATED BY DEFAULT AS IDENTITY");
  out = out.replace(/\bAUTO_INCREMENT\b/gi, "GENERATED BY DEFAULT AS IDENTITY");
  out = out.replace(/\bTINYINT(?:\(\d+\))?/gi, "SMALLINT");
  out = out.replace(/\bINT\b(?:\(\d+\))?/gi, "INTEGER");
  out = out.replace(/\bINTEGEREGER\b/gi, "INTEGER");
  out = out.replace(/\bAS\s+"IDENTITY"\b/gi, "AS IDENTITY");
  out = out.replace(/\bBIGINT(?:\(\d+\))?/gi, "BIGINT");
  out = out.replace(/\bDOUBLE\b/gi, "DOUBLE PRECISION");
  out = out.replace(/\bDATETIME\b/gi, "TIMESTAMP");
  out = out.replace(/\b(?:LONGTEXT|MEDIUMTEXT|TINYTEXT)\b/gi, "TEXT");
  out = out.replace(/\bADD\s+COLUMN\s+(.+?)\s+AFTER\s+[A-Za-z0-9_]+/gi, "ADD COLUMN $1");
  out = out.replace(/^\s*UNIQUE\s+KEY\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*,?/gim, "CONSTRAINT $1 UNIQUE ($2),");
  out = out.replace(/^\s*KEY\s+[A-Za-z0-9_]+\s*\([^)]*\)\s*,?/gim, "");
  out = out.replace(/,\s*\)/g, "\n)");

  const alterModify = out.match(/^\s*ALTER\s+TABLE\s+([A-Za-z0-9_]+)\s+MODIFY(?:\s+COLUMN)?\s+([A-Za-z0-9_]+)\s+([\s\S]+?)\s*;?\s*$/i);
  if (alterModify) {
    const tableName = alterModify[1];
    const columnName = alterModify[2];
    const definition = alterModify[3]
      .replace(/\bVARCHAR\(50\)/gi, "VARCHAR(100)")
      .replace(/\bNOT\s+NULL\b/gi, "")
      .replace(/\bNULL\b/gi, "")
      .replace(/\bDEFAULT\s+[^\s,]+/gi, "")
      .trim();
    const typeName = definition.split(/\s+/)[0] || "TEXT";
    return `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} TYPE ${typeName}`;
  }

  const alterIndex = out.match(/^\s*ALTER\s+TABLE\s+([A-Za-z0-9_]+)\s+ADD\s+INDEX\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*;?\s*$/i);
  if (alterIndex) return `CREATE INDEX IF NOT EXISTS ${alterIndex[2]} ON ${alterIndex[1]} (${alterIndex[3]})`;

  const alterKey = out.match(/^\s*ALTER\s+TABLE\s+([A-Za-z0-9_]+)\s+ADD\s+KEY\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*;?\s*$/i);
  if (alterKey) return `CREATE INDEX IF NOT EXISTS ${alterKey[2]} ON ${alterKey[1]} (${alterKey[3]})`;

  const alterUnique = out.match(/^\s*ALTER\s+TABLE\s+([A-Za-z0-9_]+)\s+ADD\s+UNIQUE\s+(?:(?:KEY|INDEX)\s+)?([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*;?\s*$/i);
  if (alterUnique) return `CREATE UNIQUE INDEX IF NOT EXISTS ${alterUnique[2]} ON ${alterUnique[1]} (${alterUnique[3]})`;

  return out;
};

const normalizeMysqlSql = (sourceSql: string): string => {
  let sql = sourceSql.trim();

  if (/^SELECT\s+DATABASE\(\)\s+AS\s+databaseName\s*,\s*@@hostname/i.test(sql)) {
    sql = "SELECT current_database() AS databaseName, inet_server_addr()::text AS databaseHost, inet_server_port() AS databasePort";
  }

  sql = sql.replace(/`/g, "");
  sql = convertMysqlDdl(sql);
  sql = sql.replace(/\bTABLE_SCHEMA\s*=\s*DATABASE\(\)/gi, "table_schema = current_schema()");
  sql = sql.replace(/\bCONSTRAINT_SCHEMA\s*=\s*DATABASE\(\)/gi, "constraint_schema = current_schema()");
  sql = sql.replace(/\bDATABASE\(\)/gi, "current_database()");
  sql = sql.replace(/@@hostname/gi, "inet_server_addr()::text");
  sql = sql.replace(/@@port/gi, "inet_server_port()");
  sql = sql.replace(/\bCURDATE\(\)/gi, "CURRENT_DATE");
  sql = sql.replace(/\bNOW\(\)/gi, "CURRENT_TIMESTAMP");
  sql = sql.replace(/\bVALUES\s*\(\s*([A-Za-z0-9_]+)\s*\)/gi, "EXCLUDED.$1");
  sql = sql.replace(/\bIFNULL\s*\(/gi, "COALESCE(");
  sql = sql.replace(/\bRAND\s*\(\s*\)/gi, "RANDOM()");

  sql = convertInsertIgnore(sql);
  sql = convertGroupConcat(sql);
  sql = replaceFunction(sql, "DATE_FORMAT", (args) => `TO_CHAR(${args[0]}, '${normalizeFormat((args[1] || "''").replace(/^'|'$/g, ""))}')`);
  sql = replaceFunction(sql, "TIME_FORMAT", (args) => `TO_CHAR((CURRENT_DATE + (${args[0]})::time)::timestamp, '${normalizeFormat((args[1] || "''").replace(/^'|'$/g, ""))}')`);
  sql = replaceFunction(sql, "TIME", (args) => `((${args[0]})::time)`);
  sql = replaceFunction(sql, "DATE", (args) => `((${args[0]})::date)`);
  sql = replaceFunction(sql, "DATE_ADD", (args) => {
    const match = (args[1] || "").match(/INTERVAL\s+([0-9]+)\s+([A-Za-z]+)/i);
    return match ? `(${args[0]} + INTERVAL '${match[1]} ${match[2].toLowerCase()}')` : `(${args.join(", ")})`;
  });
  sql = replaceFunction(sql, "DATE_SUB", (args) => {
    const match = (args[1] || "").match(/INTERVAL\s+([0-9]+)\s+([A-Za-z]+)/i);
    return match ? `(${args[0]} - INTERVAL '${match[1]} ${match[2].toLowerCase()}')` : `(${args.join(", ")})`;
  });
  sql = replaceFunction(sql, "DATEDIFF", (args) => `((${args[0]})::date - (${args[1]})::date)`);
  sql = replaceFunction(sql, "TIMESTAMPDIFF", (args) => {
    const unit = (args[0] || "").replace(/['"]/g, "").toUpperCase();
    if (unit === "YEAR") return `EXTRACT(YEAR FROM AGE(${args[2]}, ${args[1]}))::int`;
    if (unit === "MONTH") return `(EXTRACT(YEAR FROM AGE(${args[2]}, ${args[1]}))::int * 12 + EXTRACT(MONTH FROM AGE(${args[2]}, ${args[1]}))::int)`;
    return `EXTRACT(EPOCH FROM (${args[2]} - ${args[1]}))`;
  });
  sql = replaceFunction(sql, "YEAR", (args) => `EXTRACT(YEAR FROM ${args[0]})`);
  sql = replaceFunction(sql, "MONTH", (args) => `EXTRACT(MONTH FROM ${args[0]})`);
  sql = replaceFunction(sql, "DAY", (args) => `EXTRACT(DAY FROM ${args[0]})`);
  sql = replaceFunction(sql, "WEEKDAY", (args) => `(EXTRACT(ISODOW FROM (${args[0]})::date)::int - 1)`);
  sql = replaceFunction(sql, "YEARWEEK", (args) => `TO_CHAR((${args[0]})::date, 'IYYYIW')::int`);
  sql = replaceFunction(sql, "LAST_DAY", (args) => `(date_trunc('month', (${args[0]})::date) + interval '1 month - 1 day')::date`);
  sql = replaceFunction(sql, "LPAD", (args) => `LPAD((${args[0]})::text, ${args[1]}, ${args[2]})`);
  sql = replaceFunction(sql, "IF", (args) => `(CASE WHEN ${args[0]} THEN ${args[1]} ELSE ${args[2]} END)`);
  sql = replaceFunction(sql, "FIELD", (args) => {
    const expr = args[0];
    const cases = args.slice(1).map((value, index) => `WHEN ${expr} = ${value} THEN ${index + 1}`).join(" ");
    return `(CASE ${cases} ELSE 999 END)`;
  });
  sql = replaceFunction(sql, "ELT", (args) => `(ARRAY[${args.slice(1).join(", ")}])[${args[0]}::int]`);

  sql = convertOnDuplicateKey(sql);
  sql = sql.replace(/\bREGEXP\b/gi, "~");
  sql = sql.replace(/\bTRUE\b/gi, "TRUE").replace(/\bFALSE\b/gi, "FALSE");
  sql = convertMysqlCastTypes(sql);
  if (/^\s*(SELECT|WITH)\b/i.test(sql)) {
    sql = quoteCamelCaseAliases(sql);
    sql = quoteAliasReferences(sql);
    sql = normalizeOverQuotedIdentifiers(sql);
  }
  sql = normalizeOverQuotedIdentifiers(sql);
  sql = sql.replace(/\bINTEGEREGER\b/gi, "INTEGER");
  sql = sql.replace(/\bAS\s+"IDENTITY"\b/gi, "AS IDENTITY");
  sql = replaceQuestionPlaceholders(sql);
  return sql;
};

const addReturningIdIfNeeded = (sql: string): string => {
  if (!/^\s*INSERT\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) return sql;
  return `${sql} RETURNING id`;
};

const isSelectLike = (sql: string) => /^\s*(SELECT|WITH|SHOW|DESCRIBE)\b/i.test(sql);

const runQuery = async (executor: PgPool | PoolClient, sourceSql: string, params: unknown[] = []): Promise<[any, any]> => {
  let sql = normalizeMysqlSql(sourceSql);
  const selectLike = isSelectLike(sql);


  if (/INFORMATION_SCHEMA\.TABLES/i.test(sourceSql)) {
    const tableName = (params as string[])[0];
    if (/TABLE_NAME\s*=\s*\?/i.test(sourceSql) && tableName) {
      const result = await executor.query(
        `SELECT table_name AS "TABLE_NAME", table_name AS "tableName"
         FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_type = 'BASE TABLE'
           AND table_name = $1
         LIMIT 1`,
        [tableName]
      );
      return [result.rows, undefined];
    }

    const result = await executor.query(
      `SELECT c.relname AS "TABLE_NAME",
              c.relname AS "tableName",
              GREATEST(c.reltuples::bigint, 0) AS "TABLE_ROWS",
              GREATEST(c.reltuples::bigint, 0) AS "estimatedRows",
              NULL::text AS "CREATE_TIME",
              NULL::text AS "UPDATE_TIME",
              NULL::text AS "createdAt",
              NULL::text AS "updatedAt"
       FROM pg_class c
       INNER JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = current_schema()
         AND c.relkind = 'r'
       ORDER BY c.relname ASC`
    );
    return [result.rows, undefined];
  }

  if (/INFORMATION_SCHEMA\.COLUMNS/i.test(sourceSql)) {
    let tableName = (params as string[])[0];
    let columnName = (params as string[])[1];

    // Support legacy code that embeds TABLE_NAME/COLUMN_NAME as SQL literals instead
    // of using placeholders. Several operational-data endpoints use this pattern when
    // detecting whether kegiatan_indikator_kinerja uses column `nama` or `nama_kegiatan`.
    if (!tableName) {
      const tableLiteralMatch = sourceSql.match(/TABLE_NAME\s*=\s*'([^']+)'/i);
      tableName = tableLiteralMatch?.[1] || tableName;
    }
    if (!columnName) {
      const columnLiteralMatch = sourceSql.match(/COLUMN_NAME\s*=\s*'([^']+)'/i);
      columnName = columnLiteralMatch?.[1] || columnName;
    }

    if (/COUNT\s*\(\s*\*\s*\)/i.test(sourceSql)) {
      const result = await executor.query(
        `SELECT COUNT(*)::int AS "total"
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = $1
           AND ($2::text IS NULL OR column_name = $2)`,
        [tableName, columnName || null]
      );
      return [result.rows, undefined];
    }

    const result = await executor.query(
      `SELECT column_name AS "COLUMN_NAME",
              column_name AS "columnName",
              data_type AS "DATA_TYPE",
              data_type AS "dataType",
              udt_name AS "COLUMN_TYPE",
              udt_name AS "columnType",
              is_nullable AS "IS_NULLABLE",
              is_nullable AS "isNullable",
              ''::text AS "COLUMN_KEY",
              ''::text AS "columnKey",
              ordinal_position AS "ORDINAL_POSITION",
              ordinal_position AS "ordinalPosition"
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = $1
         AND ($2::text IS NULL OR column_name = $2)
       ORDER BY ordinal_position ASC
       LIMIT CASE WHEN $2::text IS NULL THEN NULL ELSE 1 END`,
      [tableName, columnName || null]
    );
    return [result.rows, undefined];
  }

  if (/INFORMATION_SCHEMA\.STATISTICS/i.test(sourceSql)) {
    const [tableName, indexName] = params as string[];
    const query = `
      SELECT indexname AS "INDEX_NAME"
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = $1
        AND indexname = $2
      LIMIT 1
    `;
    const result = await executor.query(query, [tableName, indexName]);
    return [result.rows, undefined];
  }

  if (/INFORMATION_SCHEMA\.REFERENTIAL_CONSTRAINTS/i.test(sourceSql)) {
    const [tableName, constraintName] = params as string[];
    const query = `
      SELECT tc.constraint_name AS "CONSTRAINT_NAME"
      FROM information_schema.table_constraints tc
      WHERE tc.constraint_schema = current_schema()
        AND tc.table_name = $1
        AND tc.constraint_name = $2
        AND tc.constraint_type = 'FOREIGN KEY'
      LIMIT 1
    `;
    const result = await executor.query(query, [tableName, constraintName]);
    return [result.rows, undefined];
  }

  if (!selectLike) sql = addReturningIdIfNeeded(sql);

  let result: QueryResult;
  try {
    result = await executor.query(sql, params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[PostgreSQL SQL Error]", message, { sql, params });
    throw error;
  }

  if (selectLike) return [result.rows, undefined];

  const header: ResultSetHeader = {
    affectedRows: result.rowCount || 0,
    changedRows: result.rowCount || 0,
    rowCount: result.rowCount || 0,
    insertId: Number((result.rows?.[0] as any)?.id || 0)
  };

  return [header, undefined];
};

class PgCompatConnection {
  constructor(private readonly client: PoolClient) {}

  query<T = any>(sql: string, params: unknown[] = []): Promise<[T, any]> {
    return runQuery(this.client, sql, params) as Promise<[T, any]>;
  }

  execute<T = any>(sql: string, params: unknown[] = []): Promise<[T, any]> {
    return this.query(sql, params);
  }

  beginTransaction() {
    return this.client.query("BEGIN");
  }

  commit() {
    return this.client.query("COMMIT");
  }

  rollback() {
    return this.client.query("ROLLBACK");
  }

  release() {
    this.client.release();
  }
}

class PgCompatPool {
  query<T = any>(sql: string, params: unknown[] = []): Promise<[T, any]> {
    return runQuery(pgPool, sql, params) as Promise<[T, any]>;
  }

  execute<T = any>(sql: string, params: unknown[] = []): Promise<[T, any]> {
    return this.query(sql, params);
  }

  async getConnection(): Promise<PgCompatConnection> {
    const client = await pgPool.connect();
    return new PgCompatConnection(client);
  }

  end() {
    return pgPool.end();
  }
}

export const pool = new PgCompatPool();
export { normalizeMysqlSql };
