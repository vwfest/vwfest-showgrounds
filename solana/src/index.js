'use strict';
// VW FEST SHOW GROUNDS Solana module: non-custodial. See README.md for the full interface.
const crypto = require('crypto');
const { Connection, PublicKey } = require('@solana/web3.js');
const C = require('./config');
const { Store, createStore } = require('./store');
const { Prices } = require('./prices');
const { Quotes, memoFor } = require('./quotes');
const { Builder } = require('./txbuild');
const verify = require('./verify');
const nft = require('./nft');
const rides = require('./rides');
const { Auth } = require('./auth');
const { BurnTracker } = require('./burns');
const onramp = require('./onramp');
const audit = require('./audit');

const GRACE_MS = 30 * 60 * 1000;
const PAY_TX_LIFETIME_MS = 150 * 1000; // a built tx's blockhash is valid ~60-90 s; after this it can no longer land // a signed payment may be confirmed this long after its quote expired
const fail = (why, extra = {}) => ({ ok: false, why, ...extra });

class Solana {
  // opts: { env, cfg, store, conn, prices, fetchImpl, roller, onGrant(receipt), onMinted(info), shopPrice(itemId)->usd|null,
  //         rideImage(rec)->svg|url, allowedDomains[] }
  constructor(opts = {}) {
    this.env = opts.env || process.env; this.cfg = opts.cfg || C.loadConfig(this.env); const cfg = this.cfg;
    this.problems = C.problems(cfg); this.ready = this.problems.length === 0;
    this.store = opts.store || createStore(this.env); this.f = opts.fetchImpl || fetch;
    this.conn = opts.conn || new Connection(cfg.rpcUrl, 'confirmed');
    this.prices = opts.prices || new Prices(cfg, this.f);
    this.roller = opts.roller || rides.defaultRoller;
    this.onGrant = opts.onGrant || (() => {}); this.onMinted = opts.onMinted || (() => {});
    this.shopPrice = opts.shopPrice || null; this.rideImage = opts.rideImage || null;
    const secret = cfg.serverSecret;
    // No fallback secret, ever: commit-reveal and asset addresses must come from the persistent env secret.
    this.seedOf = (id) => { if (!secret || secret.length < 32) throw new Error('SERVER_SECRET (>=32 chars) is required'); const seed = rides.serverSeed(secret, id); return { seed, commit: rides.commitOf(seed) }; };
    this.quotes = new Quotes({ cfg, store: this.store, prices: this.prices, roller: this.roller, rideSeedOf: this.seedOf });
    this.builder = new Builder({ cfg, conn: this.conn, prices: this.prices, fetchImpl: this.f });
    this.auth = secret && secret.length >= 32 ? new Auth({ store: this.store, secret, allowedDomains: opts.allowedDomains || [] }) : null;
    this.burns = new BurnTracker({ store: this.store, cfg });
    this.faucetAt = new Map();
  }
  async init() { await this.store.init(); this.burns.version++; return this; }
  async close() { await this.store.close(); }

  // ---------- public config / flags ----------
  flags() {
    const f = this.cfg.features; const off = this.problems[0] || (this.cfg.simulateOnly ? 'mainnet not armed (simulate only)' : null);
    return { enabled: this.ready && !this.cfg.simulateOnly, ready: this.ready, simulateOnly: this.cfg.simulateOnly, reason: off, network: this.cfg.network, features: f };
  }
  publicConfig() {
    const cfg = this.cfg; const k = cfg.kinds;
    return { ...this.flags(), mint: cfg.vwfestMint, decimals: cfg.decimals, devWallet: cfg.devWallet, devFeePct: cfg.devFeePct, discountPct: cfg.discountPct, slippageBps: cfg.slippageBps,
      vwfestMint: cfg.vwfestMint, rpcUrl: cfg.publicRpcUrl, memoProgram: C.MEMO_PROGRAM, prices: { avatarUsd: k.avatar.usd, rideUsd: k.ride.usd, vendorUsd: k.vendor.usd },
      discountKinds: Object.keys(k).filter((x) => k[x].discount), mintDevFee: k.avatar.devFee,
      payTokens: cfg.features.payWithSpl && cfg.mainnet ? cfg.payTokens : [], collections: { avatar: cfg.collections.avatar.address || null, ride: cfg.collections.ride.address || null },
      odds: this.roller.tiers.map((t, i) => ({ tier: t, pct: this.roller.odds[i] })), onramp: onramp.providers(cfg, this.env).map(({ id, name, how, mode, publishableKey }) => ({ id, name, how, mode, publishableKey })),
      embedded: cfg.features.embeddedWallet ? cfg.embedded : null };
  }
  odds() { return { odds: this.roller.tiers.map((t, i) => ({ tier: t, pct: this.roller.odds[i] })), method: 'commit-reveal', note: 'Each mint commits SHA-256(serverSeed) on-chain in your payment memo before the roll. roll = f(HMAC(SHA256(serverSeed:paymentSignature))). The seed is revealed in the NFT metadata; verify with verifyRide().' }; }

  // ---------- wallet auth ----------
  _needAuth() { if (!this.auth) throw new Error('SERVER_SECRET not configured'); return this.auth; }
  challenge(wallet, domain) { return this._needAuth().challenge({ wallet, domain }); }
  signIn({ wallet, nonce, signature }) { return this._needAuth().verify({ wallet, nonce, signature }); }
  session(token) { return this.auth ? this.auth.session(token) : null; }
  logout(token) { return this.auth ? this.auth.revoke(token) : false; }

  // ---------- quotes ----------
  _gate(kind, { sim = false } = {}) {
    const f = this.cfg.features;
    if (!this.ready) throw new Error('Payments are off: ' + this.problems[0]);
    if (this.cfg.simulateOnly && !sim) throw new Error('Mainnet is not armed yet (simulate only).');
    if ((kind === 'avatar' && !f.mintAvatar) || (kind === 'ride' && !f.mintRide) || (kind === 'shop' && !f.shop) || (kind === 'vendor' && !f.vendor)) throw new Error('That purchase is switched off');
  }
  // o: { wallet, kind, method, payTokenMint?, ref?, item?, usd?(shop: trusted host only), nft?{fingerprint?,traits,name?,image?,imageSvg?} }
  async quote(o) {
    this._gate(o.kind, { sim: true }); // quoting works while mainnet is disarmed (breakdown + simulation); confirming/granting does not
    const open = this.store.values('quote').filter((q) => q.wallet === o.wallet && q.state === 'open' && q.expires > Date.now());
    if (open.length >= 6) throw new Error('Too many open quotes. Finish or wait for them to expire.');
    let usd = o.usd; if (o.kind === 'shop') { usd = this.shopPrice ? this.shopPrice(o.item) : usd; if (!usd) throw new Error('Unknown shop item'); }
    let nftIn = null;
    if (this.cfg.kinds[o.kind].nft === 'avatar') {
      if (!o.nft) throw new Error('nft traits required');
      const attributes = nft.attributesFromTraits(o.nft.traits); const fingerprint = o.nft.fingerprint ? nft.cleanText(o.nft.fingerprint, 128) : nft.fingerprintOf(o.nft.traits);
      let image = null, imageSvg = null; if (o.nft.imageSvg) imageSvg = nft.checkSvg(o.nft.imageSvg); else if (o.nft.image) { image = nft.safeUrl(o.nft.image); if (!image) throw new Error('image must be an https/ipfs URL'); } else throw new Error('image or imageSvg required');
      const fp = crypto.createHash('sha256').update((this.cfg.collections.avatar.fpNamespace || this.cfg.collections.avatar.name) + ':' + fingerprint).digest('hex'); // namespaced
      if (this.store.has('minted', fp)) throw new Error('This avatar has already been minted. Change something to make it unique.');
      nftIn = { fp, fingerprint, attributes, name: nft.cleanText(o.nft.name || 'VW Fest Avatar', 48), image, imageSvg };
    }
    const q = await this.quotes.create({ ...o, usd, nft: nftIn });
    if (nftIn) this._reserveTrait(nftIn.fp, q); // synchronous (no await between check and write): only one wallet can hold a trait set
    this.store.set('quote', q.id, q);
    return this.quotes.view(q);
  }
  // Atomic trait-set reservation. store.reserve() is a synchronous put-if-absent; the only way to take over an existing entry is
  // (a) it expired, or (b) it is the SAME wallet refreshing its quote. A second wallet can therefore never get a payable quote for a held fingerprint,
  // so nobody can burn for an avatar that someone else owns the right to mint. Throws (before any payment) when the trait set is not available.
  _reserveTrait(fp, q) {
    const rec = { quoteId: q.id, wallet: q.wallet, exp: q.expires + GRACE_MS, paid: false };
    if (this.store.has('minted', fp)) throw new Error('This avatar has already been minted. Change something to make it unique.');
    if (this.store.reserve('trait', fp, rec)) return;
    const cur = this.store.get('trait', fp);
    if (cur.paid) { if (cur.wallet === q.wallet) throw new Error('You already paid for this avatar: finish minting it.'); throw new Error('This avatar is already taken. Change something to make it unique.'); }
    if (cur.exp > Date.now() && cur.wallet !== q.wallet) throw new Error('Someone else is minting this exact avatar right now. Try again in a few minutes.');
    if (cur.wallet === q.wallet && cur.quoteId !== q.id) { // same-wallet refresh: supersede the old quote unless a pay tx for it may still be in flight
      const old = this.store.get('quote', cur.quoteId);
      if (old && old.state === 'open' && old.builtAt && Date.now() - old.builtAt < PAY_TX_LIFETIME_MS) throw new Error('You have a payment in progress for this avatar. Finish it (or wait a minute) before requesting a new quote.');
      if (old && old.state === 'open') { old.state = 'superseded'; this.store.set('quote', old.id, old); }
    }
    this.store.set('trait', fp, rec);
  }
  getQuote(id, wallet) { const q = this.store.get('quote', id); return q && (!wallet || q.wallet === wallet) ? q : null; }

  // ---------- build (unsigned) transactions ----------
  async buildPay({ quoteId, wallet }) {
    this._gate(this.store.get('quote', quoteId)?.kind, { sim: true });
    const q = this.getQuote(quoteId, wallet); if (!q) return fail('Unknown quote');
    if (q.state === 'superseded') return fail('This quote was replaced by a newer one for the same avatar. Use the latest quote.');
    if (q.state !== 'open') return fail('This quote is already used');
    if (q.expires < Date.now()) return fail('This quote expired. Please request a new one.');
    if (q.nft) { const r = this.store.get('trait', q.nft.fp); if (!r || r.quoteId !== q.id || r.wallet !== q.wallet) return fail('This avatar quote is no longer reserved for you. Request a new quote.'); }
    q.builtAt = Date.now(); this.store.set('quote', q.id, q); // blocks a same-wallet refresh from superseding while this tx can still land
    const b = await this.builder.buildPay(q);
    audit.auditPayTx(audit.decodeTx(b.tx), q, this.cfg, b.alts); // never hand out a tx that fails our own audit
    return { ok: true, tx: b.tx, lastValidBlockHeight: b.lastValidBlockHeight, burnRaw: b.burnRaw, swap: b.swap, memo: memoFor(q), quote: this.quotes.view(q) };
  }
  // The NFT mint (second step, after the verified payment). Rent + fee are paid by the player; the authority only co-signs.
  async buildMint({ quoteId, wallet }) {
    this._gate(this.store.get('quote', quoteId)?.kind);
    const q = this.getQuote(quoteId, wallet); if (!q) return fail('Unknown quote');
    const kind = this.cfg.kinds[q.kind].nft; if (!kind) return fail('This purchase has no NFT');
    if (q.state !== 'paid') return fail('Payment has not been verified yet');
    if (q.mint && q.mint.state === 'minted') return fail('Already minted', { asset: q.mint.asset });
    const meta = await this._prepareMetadata(q, kind);
    const assetKey = kind === 'avatar' ? q.nft.fp : q.id;
    const b = await this.builder.buildMint({ wallet, kind, assetKey, name: meta.name, uri: meta.uri });
    audit.auditMintTx(audit.decodeTx(b.tx), { wallet, asset: b.asset, collection: this.cfg.collections[kind].address, name: meta.name, uri: meta.uri });
    q.mint = { state: 'built', asset: b.asset, uri: meta.uri, name: meta.name, at: Date.now() }; this.store.set('quote', q.id, q);
    return { ok: true, tx: b.tx, asset: b.asset, uri: meta.uri, name: meta.name, lastValidBlockHeight: b.lastValidBlockHeight, rentNote: 'Network rent + fee (about 0.003 SOL) is paid by your wallet.' };
  }
  async _prepareMetadata(q, kind) {
    const cfg = this.cfg; let name, attributes, image, description, extra = {}; const storage = this._storage();
    if (kind === 'avatar') {
      name = q.nft.name; attributes = q.nft.attributes; description = 'A unique VW FEST SHOW GROUNDS avatar. One of a kind: no other avatar has this exact trait set.';
      image = q.nft.image || await storage.putImage(q.nft.fp, q.nft.imageSvg);
    } else {
      const r = this.store.get('ride', q.id); if (!r) throw new Error('Ride has not been revealed');
      name = `${rides.tierName(this.roller, r.spec)} VW #${String(r.build || '').padStart(4, '0') || q.id.slice(1, 5)}`; attributes = r.attributes; description = 'A VW FEST SHOW GROUNDS ride with a VWFEST plate. Rarity rolled with published odds and commit-reveal randomness: verify it with the revealed seed.';
      extra = { fairness: { commit: r.commit, seed: r.seed, paymentSignature: r.sig, reroll: r.reroll, odds: this.roller.odds, tiers: this.roller.tiers } };
      const img = this.rideImage ? await this.rideImage(r) : null; if (!img) throw new Error('rideImage callback not provided');
      image = /^\s*<(\?xml|svg)/i.test(img) ? await storage.putImage(q.id, nft.checkSvg(img)) : nft.safeUrl(img);
      if (!image) throw new Error('bad ride image');
    }
    const metaId = kind === 'avatar' ? q.nft.fp.slice(0, 32) : q.id;
    const json = nft.buildMetadata({ kind, cfg, id: metaId, name, description, image, attributes, extra });
    const uri = await storage.putJson(metaId, json);
    return { name, uri, json };
  }
  _storage() {
    const cfg = this.cfg; const store = this.store; const base = cfg.publicBase;
    if (cfg.storage.driver === 'pinata') {
      const jwt = cfg.storage.pinataJwt; if (!jwt) throw new Error('PINATA_JWT missing'); const gw = cfg.storage.gateway; const f = this.f;
      const up = async (blob, name) => { const fd = new FormData(); fd.append('file', blob, name); fd.append('network', 'public'); const r = await f('https://uploads.pinata.cloud/v3/files', { method: 'POST', headers: { authorization: 'Bearer ' + jwt }, body: fd, signal: AbortSignal.timeout(30000) }); const j = await r.json().catch(() => ({})); const cid = j.data && j.data.cid; if (!r.ok || !cid) throw new Error('Storage upload failed'); return `${gw}/ipfs/${cid}`; };
      return { putImage: (id, svg) => up(new Blob([svg], { type: 'image/svg+xml' }), id + '.svg'), putJson: (id, json) => up(new Blob([JSON.stringify(json)], { type: 'application/json' }), id + '.json') };
    }
    if (!base) throw new Error('PUBLIC_BASE_URL is required for server-hosted NFT metadata');
    return {
      putImage: async (id, svg) => { store.set('nftimg', id, svg); return `${base}/api/solana/nft/img/${id}.svg`; },
      putJson: async (id, json) => { store.set('nftmeta', id, json); return `${base}/api/solana/nft/meta/${id}.json`; },
    };
  }

  // ---------- confirm payment (verifies on-chain, grants exactly once) ----------
  async confirmPayment({ quoteId, signature, wallet, nick }) {
    if (!this.ready || this.cfg.simulateOnly) return fail('Payments are off');
    if (!verify.isSig(signature)) return fail('Bad signature');
    const q = this.getQuote(quoteId, wallet); if (!q) return fail('Unknown quote');
    // ---- everything below up to the first await is synchronous: this is the replay / double-grant guard ----
    const prior = this.store.get('sig', signature);
    if (prior) { if (prior.quoteId === q.id && prior.state === 'paid') return { ok: true, repeat: true, receipt: this.store.get('receipt', q.id) }; return fail(prior.state === 'pending' && prior.quoteId === q.id ? 'Verification in progress' : 'This transaction was already used', { pending: prior.state === 'pending' }); }
    if (q.state === 'paid') return fail('This quote is already paid');
    if (q.state === 'superseded') return fail('This quote was replaced by a newer one for the same avatar.');
    if (q.state !== 'open') return fail('Verification in progress', { pending: true });
    if (q.expires + GRACE_MS < Date.now()) return fail('This quote expired');
    if (q.nft) { const r = this.store.get('trait', q.nft.fp); if (!r || r.quoteId !== q.id || r.wallet !== q.wallet) return fail('This avatar is no longer reserved for this quote.'); }
    this.store.reserve('sig', signature, { quoteId: q.id, state: 'pending', at: Date.now() });
    q.state = 'verifying'; this.store.set('quote', q.id, q);
    const release = () => { this.store.delete('sig', signature); q.state = 'open'; this.store.set('quote', q.id, q); };
    let v;
    try { v = await verify.verifyPayment({ conn: this.conn, cfg: this.cfg, q, sig: signature, tries: this.verifyTries, delayMs: this.verifyDelayMs }); }
    catch (e) { release(); return fail('Could not check the blockchain right now. Try again.', { retry: true }); }
    if (!v.ok) { release(); return fail(v.why, { retry: !!v.retry }); }
    // ---- success: synchronous again until the grant callback ----
    q.state = 'paid'; q.paySig = signature; q.paidAt = Date.now(); q.verified = v;
    this.store.set('sig', signature, { quoteId: q.id, state: 'paid', at: Date.now() });
    const kindCfg = this.cfg.kinds[q.kind];
    let rideRec = null;
    if (kindCfg.nft === 'ride') {
      const { seed, commit } = this.seedOf(q.id);
      const roll = rides.rollRide({ seed, sig: signature, roller: this.roller, taken: (code) => this.store.has('ridecode', code) });
      this.store.set('ridecode', roll.code, q.id);
      rideRec = { id: q.id, wallet: q.wallet, seed, commit, sig: signature, reroll: roll.reroll, spec: roll.spec, code: roll.code, attributes: this.roller.attributes(roll.spec), build: roll.spec.serial !== undefined ? roll.spec.serial : undefined, tier: rides.tierName(this.roller, roll.spec), ts: Date.now() };
      this.store.set('ride', q.id, rideRec);
    }
    if (kindCfg.nft === 'avatar') this.store.set('trait', q.nft.fp, { quoteId: q.id, wallet: q.wallet, exp: Number.MAX_SAFE_INTEGER, paid: true }); // permanent: paid, waiting for the mint
    this.store.set('quote', q.id, q);
    this.burns.record({ sig: signature, quoteId: q.id, kind: q.kind, item: q.item || null, wallet: q.wallet, amount: v.burn, method: q.method, devLamports: v.devLamports, nick: nick ? nft.cleanText(nick, 14) : null });
    const receipt = { quoteId: q.id, kind: q.kind, item: q.item || null, ref: q.ref, wallet: q.wallet, method: q.method, usd: q.usd, paidUsd: q.paidUsd, burned: v.burn, burnedUi: Number(BigInt(v.burn)) / 10 ** this.cfg.decimals, devLamports: v.devLamports, devTokenRaw: v.devTokenRaw, signature, explorer: this.cfg.explorer(signature, 'tx'), nft: kindCfg.nft ? { kind: kindCfg.nft, status: 'pay-verified' } : null, ride: rideRec ? { tier: rideRec.tier, attributes: rideRec.attributes, commit: rideRec.commit, seed: rideRec.seed, spec: rideRec.spec, reroll: rideRec.reroll } : null, grant: 'pending', ts: Date.now() };
    this.store.set('receipt', q.id, receipt);
    await this._deliver(receipt);
    return { ok: true, receipt: this.store.get('receipt', q.id) };
  }
  async _deliver(receipt) { // once per receipt: grant is set before the callback so a concurrent path can never call it twice
    const r = this.store.get('receipt', receipt.quoteId); if (!r || r.grant === 'delivered' || r.grant === 'delivering') return;
    this.store.set('receipt', r.quoteId, { ...r, grant: 'delivering' });
    try { await this.onGrant({ ...r }); this.store.set('receipt', r.quoteId, { ...this.store.get('receipt', r.quoteId), grant: 'delivered' }); }
    catch (e) { console.error('[solana] onGrant failed:', e.message); this.store.set('receipt', r.quoteId, { ...this.store.get('receipt', r.quoteId), grant: 'failed' }); }
  }
  pendingGrants() { return this.store.values('receipt').filter((r) => r.grant === 'failed' || r.grant === 'pending'); }
  async retryGrants() { for (const r of this.pendingGrants()) { this.store.set('receipt', r.quoteId, { ...r, grant: 'pending' }); await this._deliver(r); } }
  receipt(quoteId, wallet) { const r = this.store.get('receipt', quoteId); return r && (!wallet || r.wallet === wallet) ? r : null; }
  receiptsFor(wallet) { return this.store.values('receipt').filter((r) => r.wallet === wallet); }

  // ---------- confirm mint ----------
  async confirmMint({ quoteId, signature, wallet }) {
    const q = this.getQuote(quoteId, wallet); if (!q) return fail('Unknown quote');
    if (q.state !== 'paid' || !q.mint) return fail('Nothing to confirm');
    if (q.mint.state === 'minted') return { ok: true, repeat: true, asset: q.mint.asset, uri: q.mint.uri };
    if (q.mint.state === 'verifying') return fail('Verification in progress', { pending: true });
    q.mint.state = 'verifying'; this.store.set('quote', q.id, q);
    const kind = this.cfg.kinds[q.kind].nft; let v;
    try { v = await verify.verifyMint({ conn: this.conn, cfg: this.cfg, kind, asset: q.mint.asset, wallet, uri: q.mint.uri, sig: signature, tries: this.verifyTries, delayMs: this.verifyDelayMs }); }
    catch { q.mint.state = 'built'; this.store.set('quote', q.id, q); return fail('Could not check the blockchain right now. Try again.', { retry: true }); }
    if (!v.ok) { q.mint.state = 'built'; this.store.set('quote', q.id, q); return fail(v.why, { retry: !!v.retry }); }
    q.mint = { ...q.mint, state: 'minted', sig: signature || null, mintedAt: Date.now() }; this.store.set('quote', q.id, q);
    if (kind === 'avatar') this.store.set('minted', q.nft.fp, { asset: q.mint.asset, wallet, quoteId: q.id });
    this.burns.attachAsset(q.paySig, q.mint.asset);
    const r = this.store.get('receipt', q.id); if (r) this.store.set('receipt', q.id, { ...r, nft: { kind, status: 'minted', asset: q.mint.asset, uri: q.mint.uri, url: this.cfg.explorer(q.mint.asset, 'address') } });
    try { await this.onMinted({ quoteId: q.id, kind, wallet, asset: q.mint.asset, uri: q.mint.uri, ref: q.ref }); } catch (e) { console.error('[solana] onMinted failed:', e.message); }
    return { ok: true, asset: q.mint.asset, uri: q.mint.uri, url: this.cfg.explorer(q.mint.asset, 'address') };
  }

  // ---------- NFT as avatar ----------
  async listNfts(wallet) { if (!this.cfg.features.nftAvatarLookup) throw new Error('NFT avatars are off'); return nft.ownedNfts({ cfg: this.cfg, conn: this.conn, wallet, fetchImpl: this.f }); }
  async useNftAsAvatar({ wallet, asset }) {
    if (!this.cfg.features.nftAvatarLookup) return fail('NFT avatars are off');
    const v = await nft.verifyOwnership({ cfg: this.cfg, conn: this.conn, wallet, asset, fetchImpl: this.f }); if (!v) return fail('That NFT is not in your wallet');
    let image = v.image || null;
    if (!image && v.uri) { try { const j = await nft.safeGetJson(v.uri, { gateway: this.cfg.storage.gateway, allowHosts: this.cfg.metadataHosts, ...(this.safeFetchOpts || {}) }); image = nft.safeUrl(j && j.image || ''); } catch { /* unreachable / blocked metadata: avatar still works without an image */ } }
    return { ok: true, avatar: { asset: v.asset, name: v.name, image, standard: v.standard, collection: v.collection, verifiedAt: Date.now(), wallet } };
  }

  // ---------- misc ----------
  burnTracker(limit) { return this.burns.summary(limit); }
  onrampSession(provider, { wallet, usd, ip, redirect }) { if (!this.cfg.features.onramp) throw new Error('On-ramp is off'); return onramp.createSession(this.cfg, provider, { address: wallet, usd, ip, redirect }, { fetchImpl: this.f, env: this.env }); }
  nftMeta(id) { return this.store.get('nftmeta', id) || null; }
  nftImg(id) { return this.store.get('nftimg', id) || null; }
  collectionMeta(kind) { const c = this.cfg.collections[kind]; if (!c) return null; return { name: c.name, symbol: c.symbol, description: kind === 'avatar' ? 'Unique avatars from the VW FEST SHOW GROUNDS metaverse.' : 'Rides with VWFEST plates from the VW FEST SHOW GROUNDS: Common to Mythic lowriders.', image: this.cfg.publicBase ? this.cfg.publicBase + '/api/solana/nft/collection/' + kind + '.svg' : undefined, external_url: this.cfg.publicBase || undefined }; }
  // Devnet/localnet only: hands out test $VWFEST (the authority key must be the test mint's authority).
  async devnetFaucet(wallet, amountUi = 100000) {
    if (!this.cfg.testnet) throw new Error('Faucet is test-network only'); if (!C.isKey(wallet)) throw new Error('bad wallet');
    const last = this.faucetAt.get(wallet) || 0; if (Date.now() - last < 60000) throw new Error('Faucet: wait a minute'); this.faucetAt.set(wallet, Date.now());
    const spl = require('@solana/spl-token'); const mint = new PublicKey(this.cfg.vwfestMint); const prog = await this.builder.tokenProgramOf(this.cfg.vwfestMint);
    const ata = await spl.getOrCreateAssociatedTokenAccount(this.conn, this.cfg.authority, mint, new PublicKey(wallet), false, 'confirmed', undefined, prog);
    const sig = await spl.mintTo(this.conn, this.cfg.authority, mint, ata.address, this.cfg.authority, BigInt(Math.round(amountUi * 10 ** this.cfg.decimals)), [], undefined, prog);
    return { ok: true, signature: sig, amount: amountUi };
  }
}
module.exports = { Solana, ...C, rides, verifyRide: rides.verifyRide, nft, audit, verify, onramp, Store, createStore, memoFor };
