import os

# Tests never touch Supabase, whatever is in .env.local.
os.environ["HONE_STORE"] = "sqlite"
