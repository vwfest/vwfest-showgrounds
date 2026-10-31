'use strict';
// Server-side transaction construction. The server only BUILDS unsigned transactions (plus the collection-authority/asset co-signatures
// that Core requires); the player's wallet signs and the player's own RPC broadcasts. The server never holds user keys or funds and
// has no route that sends a transaction.
const { PublicKey, TransactionMessage, VersionedTransaction, SystemProgram, ComputeBudgetProgram, TransactionInstruction } = require('@solana/web3.js');
const spl = require('@solana/spl-token'); const crypto = require('crypto'); const ACCOUNT_SIZE = 165; // SPL token account (standard Token program)
const C = require('./config');
const jup = require('./jupiter');
const nft = require('./nft');
const { memoFor } = require('./quotes');

class Builder {
  constructor({ cfg, conn, prices, fetchImpl = fetch }) { this.cfg = cfg; this.conn = conn; this.prices = prices; this.f = fetchImpl; this._prog = new Map(); }
  async tokenProgramOf(mint) {
    if (this._prog.has(mint)) return this._prog.get(mint);
    const info = await this.conn.getAccountInfo(new PublicKey(mint), 'confirmed'); if (!info) throw new Error('Token mint not found on ' + this.cfg.network);
    const p = info.owner.toBase58(); if (p !== C.TOKEN_PROGRAM && p !== C.TOKEN_2022_PROGRAM) throw new Error('Not an SPL token mint');
    this._prog.set(mint, new PublicKey(p)); return this._prog.get(mint);
  }
  async finish({ payer, ixs, alts = [], signers = [] }) {
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash('confirmed');
    const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(alts);
    const tx = new VersionedTransaction(msg); if (signers.length) tx.sign(signers);
    const size = tx.serialize().length; if (size > 1232) throw new Error(`Transaction too large (${size} bytes). The swap route changed; try again.`);
    return { tx, lastValidBlockHeight, blockhash, size };
  }
  // Payment transaction: [budget] [ATA] [dev fee] [swap] burnChecked memo.  Returns {tx(base64), burnRaw, ...}
  async buildPay(q) {
    const cfg = this.cfg; const user = new PublicKey(q.wallet); const mint = new PublicKey(cfg.vwfestMint); const prog = await this.tokenProgramOf(cfg.vwfestMint);
    const ata = spl.getAssociatedTokenAddressSync(mint, user, false, prog);
    const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: q.swap ? 600000 : 120000 })]; let alts = []; let burn = BigInt(q.burnRaw), swapInfo = null;
    if (q.devLamports && BigInt(q.devLamports) > 0n) ixs.push(SystemProgram.transfer({ fromPubkey: user, toPubkey: new PublicKey(q.devWallet), lamports: BigInt(q.devLamports) }));
    if (q.devTokenRaw && BigInt(q.devTokenRaw) > 0n) {
      const tm = new PublicKey(q.devTokenMint); const tp = await this.tokenProgramOf(q.devTokenMint); const dev = new PublicKey(q.devWallet);
      const from = spl.getAssociatedTokenAddressSync(tm, user, false, tp), to = spl.getAssociatedTokenAddressSync(tm, dev, true, tp);
      ixs.push(spl.createAssociatedTokenAccountIdempotentInstruction(user, to, dev, tm, tp), spl.createTransferCheckedInstruction(from, tm, to, user, BigInt(q.devTokenRaw), q.payToken.dec, [], tp));
    }
    if (q.swap) {
      ixs.push(spl.createAssociatedTokenAccountIdempotentInstruction(user, ata, user, mint, prog));
      const maxSol = q.swapInputMint === C.WSOL ? BigInt(q.swapInRaw) + 10000000n : 10000000n; // swap amount + rent for temp accounts
      // Token-funded swaps are ISOLATED: exactly swapInRaw moves from the player's own token account into a temporary account (createAccountWithSeed, base = the player, so no extra signer);
      // Jupiter's route is rewritten to take its input from that account only, and the account is closed back to the player afterwards. The route can never reach more than the quoted input.
      let iso = null; const pre = [], post = [];
      if (q.swapInputMint !== C.WSOL) {
        const inProg = await this.tokenProgramOf(q.swapInputMint); if (inProg.toBase58() !== C.TOKEN_PROGRAM) throw new Error('This token cannot be used to pay (only standard SPL tokens are supported for swaps).');
        const im = new PublicKey(q.swapInputMint), main = spl.getAssociatedTokenAddressSync(im, user, false, inProg); if (!q.payToken || !Number.isInteger(q.payToken.dec)) throw new Error('Pay token decimals missing from the quote'); const dec = q.payToken.dec;
        const seed = crypto.randomBytes(8).toString('hex'); const temp = await PublicKey.createWithSeed(user, seed, inProg); const rent = await this.conn.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);
        iso = { temp: temp.toBase58(), main: main.toBase58() };
        pre.push(SystemProgram.createAccountWithSeed({ fromPubkey: user, newAccountPubkey: temp, basePubkey: user, seed, lamports: rent, space: ACCOUNT_SIZE, programId: inProg }), new TransactionInstruction({ programId: inProg, keys: [{ pubkey: temp, isSigner: false, isWritable: true }, { pubkey: im, isSigner: false, isWritable: false }], data: Buffer.concat([Buffer.from([18]), user.toBuffer()]) }) /* InitializeAccount3 */, spl.createTransferCheckedInstruction(main, im, temp, user, BigInt(q.swapInRaw), dec, [], inProg));
        post.push(new TransactionInstruction({ programId: inProg, keys: [{ pubkey: temp, isSigner: false, isWritable: true }, { pubkey: user, isSigner: false, isWritable: true }, { pubkey: user, isSigner: true, isWritable: false }], data: Buffer.from([9]) }) /* CloseAccount */);
      }
      const sw = await jup.swapInstructions({ cfg, prices: this.prices, conn: this.conn, user: q.wallet, inputMint: q.swapInputMint, amount: BigInt(q.swapInRaw), maxSolLamports: maxSol, iso, allow: [ata.toBase58()], fetchImpl: this.f });
      if (sw.minOut < BigInt(q.burnMin)) throw new Error('The price moved since your quote. Please request a new quote.');
      ixs.push(...pre, ...sw.instructions, ...post); alts = sw.alts; burn = sw.minOut; swapInfo = { expectOut: sw.outAmount.toString(), minOut: sw.minOut.toString() };
    } else if (q.method === 'vwfest' || q.network !== 'mainnet-beta') {
      const bal = await this.conn.getTokenAccountBalance(ata, 'confirmed').catch(() => null); const have = bal ? BigInt(bal.value.amount) : 0n;
      if (have < burn) throw new Error(`You need ${Number(burn) / 10 ** cfg.decimals} $VWFEST in this wallet, but it holds ${Number(have) / 10 ** cfg.decimals}.`);
    }
    ixs.push(spl.createBurnCheckedInstruction(ata, mint, user, burn, cfg.decimals, [], prog));
    ixs.push(new TransactionInstruction({ programId: new PublicKey(C.MEMO_PROGRAM), keys: [{ pubkey: user, isSigner: true, isWritable: false }], data: Buffer.from(memoFor(q)) }));
    const f = await this.finish({ payer: user, ixs, alts });
    return { tx: Buffer.from(f.tx.serialize()).toString('base64'), lastValidBlockHeight: f.lastValidBlockHeight, burnRaw: burn.toString(), swap: swapInfo, size: f.size, alts };
  }
  // Mint transaction. `meta` = { name, uri }. Co-signed by the collection authority and the deterministic asset keypair.
  async buildMint({ wallet, kind, assetKey, name, uri }) {
    const cfg = this.cfg; const col = cfg.collections[kind]; if (!col.address) throw new Error('Collection not configured: run scripts/create-collections.js');
    if (!cfg.authority) throw new Error('AUTHORITY_SECRET_KEY missing');
    const user = new PublicKey(wallet); const asset = nft.assetKeypair(cfg.serverSecret, col.address, assetKey);
    const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 120000 }), nft.createAssetIx({ asset: asset.publicKey, collection: new PublicKey(col.address), authority: cfg.authority.publicKey, payer: user, owner: user, name, uri })];
    const f = await this.finish({ payer: user, ixs, signers: [asset, cfg.authority] });
    return { tx: Buffer.from(f.tx.serialize()).toString('base64'), asset: asset.publicKey.toBase58(), lastValidBlockHeight: f.lastValidBlockHeight, size: f.size };
  }
}
module.exports = { Builder };
