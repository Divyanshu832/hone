# Cloud key layer: a stronger home for users' keys

**Status:** plan, not built. **Today:** keys are encrypted with Supabase Vault (see the handbook,
section 6). This document is the next step if Hone becomes a real product.

## Why go further than Vault

Vault encrypts every key at rest, and Hone reads keys only through two functions that only the server's
secret key can call. That protects against a leaked backup or a stolen database file.

What it doesn't fully separate: **the encryption key and the encrypted data both live with Supabase.**
Anyone who can run SQL as a privileged role (a leaked service key, a compromised Supabase account) can
read `vault.decrypted_secrets` and get every key in one query.

A cloud key service (AWS KMS, Google Cloud KMS or Azure Key Vault) fixes that split. The master key lives
in dedicated hardware at the cloud provider. **It can't be exported, by anyone.** Every use of it is
logged. A stolen database becomes useless on its own.

## The design: envelope encryption

Two layers of keys, so the cloud key service is called rarely and each organization's keys can be locked
or deleted on their own.

```
Cloud KMS master key (never leaves KMS)
   └── wraps ──▶ one data key per organization   (stored wrapped, in Supabase)
                    └── encrypts ──▶ that organization's OpenRouter / TypeSafe / n8n / Retell keys
```

### Saving a key
1. First key for an organization: ask KMS for a new data key. KMS returns it twice, in plain form and
   wrapped (encrypted under the master key).
2. Encrypt the user's key with the plain data key: AES-256-GCM, a random 12-byte nonce, and the
   organization id plus field name as associated data. The associated data stops anyone copying one
   organization's ciphertext into another organization's row.
3. Store `ciphertext`, `nonce`, `wrapped_data_key` and `key_version` in Supabase.
4. Drop the plain data key from memory.

### Using a key
1. A request arrives for an organization. Send its wrapped data key to KMS, which unwraps it and logs
   the call.
2. Decrypt the user's key in memory and use it for that request and its background run.
3. Cache the unwrapped data key for a few minutes, so a 13-scenario run costs one KMS call, not hundreds.

### What sits where
| Place | Holds | Alone, can it read keys? |
|---|---|---|
| Supabase | ciphertext, nonce, wrapped data key | No: the data key is wrapped |
| Cloud KMS | the master key | No: it never sees the ciphertext |
| Hone server | permission to call KMS (an IAM role, no key file) | Only while it runs, and every call is logged |

An attacker needs **all three at once**: the database, the server's cloud permissions, and a live
server.

## Extra protection this unlocks
- **Audit trail:** CloudTrail / Cloud Audit Logs record every unwrap, with time and caller. An
  unexpected spike is visible.
- **Key rotation:** KMS rotates the master key on a schedule. The `key_version` column lets old rows be
  rewrapped in the background, with no downtime.
- **Instant lockout:** disabling an organization's data key makes its secrets unreadable at once, for
  example after a breach report.
- **Crypto-shredding:** deleting an organization deletes its wrapped data key. Its ciphertext is then
  unrecoverable, including from old backups.
- **No key file on the server:** the server gets KMS access through its cloud identity (IAM role or
  workload identity), so there's no secret to leak from `.env`.

## Moving from Vault (no downtime)
1. Add the columns (`ciphertext`, `nonce`, `wrapped_data_key`, `key_version`) or a `hone_keys` table.
2. Write new keys to KMS-encrypted storage; read from it first, falling back to Vault.
3. A one-off job re-encrypts every Vault secret under KMS and checks each by reading it back.
4. Delete the `hone:` secrets from Vault and the two Vault functions.

The rest of Hone doesn't change. `store.get("secret", …)` and `auth.org_keys_raw()` are the only places
that read keys, so only those two functions are rewritten.

## Cost and effort
- **KMS:** about $1 a month per master key, plus about $0.03 per 10,000 calls. With data-key caching,
  Hone stays well under a dollar or two a month.
- **Code:** roughly 100–150 lines (a small `keystore.py` using `boto3` or `google-cloud-kms` and
  `cryptography`), the migration job, and tests.
- **Ops:** a cloud account, one master key, and an IAM role for the server.

## Still true after this
If someone fully takes over the running server, they can use keys while they control it. No product that
calls models for its users can avoid that. The extra layers on top:
- **Spending caps:** Settings should tell people to make a separate OpenRouter key for Hone with a
  spending limit, so a leaked key can only cost that much.
- **Owner-only changes:** only owners can replace an organization's keys.
- **"Last used" time:** shown next to each key, so misuse is visible.
- **Log scrubbing:** request and error logs are scrubbed, so a key never lands in a log.
