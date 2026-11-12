// Generates an ed25519 keypair and writes a near-cli-rs access-key file. Prints only the public key.
// usage: node scripts/gen-key.cjs <account_id> <out_file>
const { KeyPair } = require("../app/node_modules/near-api-js");
const fs = require("fs");
const [accountId, out] = process.argv.slice(2);
const kp = KeyPair.fromRandom("ed25519");
fs.writeFileSync(
  out,
  JSON.stringify({ account_id: accountId, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }) + "\n",
  { mode: 0o600 },
);
console.log(kp.getPublicKey().toString());
