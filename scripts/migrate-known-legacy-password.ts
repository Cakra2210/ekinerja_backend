import "dotenv/config";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../src/config/database";
import { ensureAuthSchema, hashLegacyPassword, hashPassword, isLegacySha256Hash } from "../src/features/auth/auth.security";

type AccountRow = RowDataPacket & {
  id: number;
  username: string;
  passwordHash: string;
};

const main = async () => {
  const knownPassword = String(process.argv[2] || process.env.LEGACY_DEFAULT_PASSWORD || "").trim();

  if (!knownPassword) {
    throw new Error(
      "Masukkan password lama yang diketahui. Contoh: npm run migrate:known-password -- 123456"
    );
  }

  await ensureAuthSchema();

  const legacyHash = hashLegacyPassword(knownPassword);
  const [rows] = await pool.query<AccountRow[]>(
    `SELECT id, username, password_hash AS passwordHash
     FROM user_accounts
     WHERE password_hash = ?`,
    [legacyHash]
  );

  if (!rows.length) {
    console.log("Tidak ada akun legacy dengan password yang cocok.");
    return;
  }

  let migrated = 0;
  for (const row of rows) {
    if (!isLegacySha256Hash(row.passwordHash)) {
      continue;
    }

    const newHash = await hashPassword(knownPassword);
    await pool.query<ResultSetHeader>(
      `UPDATE user_accounts
       SET password_hash = ?,
           must_change_password = 1
       WHERE id = ?`,
      [newHash, row.id]
    );
    migrated += 1;
    console.log(`Migrated: ${row.username}`);
  }

  console.log(`Selesai. Total akun dimigrasikan: ${migrated}`);
};

main()
  .catch((error) => {
    console.error("Migrasi gagal:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
