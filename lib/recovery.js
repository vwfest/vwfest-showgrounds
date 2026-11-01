// Profile recovery by wallet signature. A profile is recoverable ONLY by a wallet that paid for AND received one of its NFTs
// (avatar mint or Mystery Ride: the verifier requires the NFT to be minted to the burning signer, so payer == recipient).
// Shop / booth payments are NOT enough (a friend paying for an outfit must not be able to take the profile).
// Flow (all over the game WebSocket, before join): rauth {pubkey} -> server nonce challenge (purpose "recover", domain-bound, 3 min, single use)
// -> rproof {pubkey, nonce, sig} -> server verifies ed25519 -> list of matching profiles -> rclaim {id} (must be in that list, once)
// -> the profile secret is ROTATED (old browser copies stop working) and the new credential is sent only to this socket.
exports.profilesForWallet = (pubkey, { rides, burns, profiles }) => {
  if (typeof pubkey !== 'string' || !pubkey) return [];
  const pids = new Set();
  for (const r of rides.byId.values()) if (r.wallet === pubkey && r.pid) pids.add(r.pid);
  for (const b of burns.list) if (b.wallet === pubkey && b.pid && (b.kind === 'mint' || b.kind === 'ride')) pids.add(b.pid);
  const out = [];
  for (const id of pids) { const p = profiles.byId.get(id); if (p) out.push({ id: p.id, nick: p.nick, rides: rides.forProfile(p.id).length }); }
  return out.sort((a, b) => a.nick.localeCompare(b.nick)).slice(0, 20);
};
