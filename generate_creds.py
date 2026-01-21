#!/usr/bin/env python3
"""
Generate Polymarket API credentials from your wallet private key.
DELETE THIS FILE after running - never commit private keys to git.
"""

# PASTE YOUR PRIVATE KEY HERE (with or without 0x prefix)
PRIVATE_KEY = "PASTE_YOUR_KEY_HERE"

# ─────────────────────────────────────────────────────────

from py_clob_client.client import ClobClient

if PRIVATE_KEY == "PASTE_YOUR_KEY_HERE":
    print("ERROR: Edit this file and paste your private key first")
    exit(1)

# Add 0x prefix if missing
if not PRIVATE_KEY.startswith("0x"):
    PRIVATE_KEY = "0x" + PRIVATE_KEY

client = ClobClient(
    "https://clob.polymarket.com",
    key=PRIVATE_KEY,
    chain_id=137
)

print("Generating credentials...")
creds = client.create_or_derive_api_creds()

print("\n✅ Add these to your .env file:\n")
print(f"POLY_API_KEY={creds.api_key}")
print(f"POLY_API_SECRET={creds.api_secret}")
print(f"POLY_PASSPHRASE={creds.api_passphrase}")
print(f"POLY_ADDRESS={client.get_address()}")
print("\n⚠️  Now delete this file: rm generate_creds.py")
