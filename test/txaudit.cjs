// Client pre-sign audit of Jupiter instructions (src/txaudit.js): SOL cap, SPL transfer/transferChecked amount cap, forbidden token ops, program allow-list, signed-message identity.
const assert = require('assert'); const path = require('path'); const { pathToFileURL } = require('url');
const U = 'BqRM2Me3BriYQ9j4Dx2pXsbKWQ3AwELqqPu3Rd1QUwvZ', X = 'DV4gtG2VpnDtFUVFnnrE5YM3A6LrV5qAcdfaaUwLFRok', TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', SYS = '11111111111111111111111111111111';
const b64 = (arr) => Buffer.from(arr).toString('base64'); const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return [...b]; };
const tIx = (op, amt, accts, prog = TOKEN) => ({ programId: prog, accounts: accts.map((pubkey) => ({ pubkey })), data: b64([op, ...(amt === null ? [] : u64(amt)), ...(op === 12 ? [6] : [])]) });
const sysIx = (kind, lamports) => ({ programId: SYS, accounts: [{ pubkey: U }, { pubkey: X }], data: b64([kind, 0, 0, 0, ...u64(lamports)]) });
let n = 0; const t = async (name, f) => { try { await f(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, e.stack.split('\n').slice(0, 3).join(' | ')); process.exitCode = 1; } };
(async () => {
  const { audit, sameMessage } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'txaudit.mjs')).href);
  const bad = (f, re) => assert.throws(f, re);
  await t('SOL: transfer within the cap passes, above it is refused', () => { audit([sysIx(2, 1000)], 2000n, { user: U }); bad(() => audit([sysIx(2, 5000)], 2000n, { user: U }), /more SOL/); bad(() => audit([sysIx(2, 1000), sysIx(0, 1500)], 2000n, { user: U }), /more SOL/); });
  await t('token: transfer / transferChecked signed by the player are capped by maxTokenIn', () => {
    audit([tIx(3, 500, ['a', 'b', U])], 0n, { user: U, maxTokenIn: 600n }); audit([tIx(12, 500, ['a', 'm', 'b', U])], 0n, { user: U, maxTokenIn: 600n });
    bad(() => audit([tIx(3, 700, ['a', 'b', U])], 0n, { user: U, maxTokenIn: 600n }), /more tokens/); bad(() => audit([tIx(12, 700, ['a', 'm', 'b', U])], 0n, { user: U, maxTokenIn: 600n }), /more tokens/);
    bad(() => audit([tIx(3, 400, ['a', 'b', U]), tIx(12, 400, ['a', 'm', 'b', U])], 0n, { user: U, maxTokenIn: 600n }), /more tokens/);
  });
  await t('SOL-funded swap allows NO token transfer from the player (default maxTokenIn = 0)', () => { bad(() => audit([tIx(3, 1, ['a', 'b', U])], 10n, { user: U }), /more tokens/); audit([tIx(3, 1, ['a', 'b', 'someoneElse'])], 10n, { user: U }); });
  await t('approve / setAuthority / burn / mint / freeze never appear in a swap route', () => { for (const op of [4, 6, 8, 13, 15, 7, 14, 10, 11]) bad(() => audit([tIx(op, 1, ['a', 'b', U])], 10n, { user: U, maxTokenIn: 10n }), /Unexpected token instruction/); });
  await t('closeAccount (9) may only return SOL to the player; syncNative (17) is fine', () => { audit([tIx(9, null, ['a', U, U])], 0n, { user: U }); bad(() => audit([tIx(9, null, ['a', X, U])], 0n, { user: U }), /elsewhere/); audit([tIx(17, null, ['a'])], 0n, { user: U }); });
  await t('unknown program refused; system assign/allocate refused', () => { bad(() => audit([{ programId: 'EvilProgram1111111111111111111111111111111', accounts: [], data: b64([0]) }], 0n), /unexpected program/); bad(() => audit([{ programId: SYS, accounts: [], data: b64([1, 0, 0, 0]) }], 0n), /Unexpected system/); });
  await t('the wallet must return the exact message that was audited', () => { assert(sameMessage(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3))); assert(!sameMessage(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 4))); assert(!sameMessage(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 3))); assert(!sameMessage(null, Uint8Array.of(1))); });
  console.log(process.exitCode ? 'TXAUDIT TESTS FAILED' : `all ${n} tx audit tests passed`);
})();
