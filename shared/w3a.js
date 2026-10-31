// Origins the Web3Auth (Sign in with Google) embedded wallet needs. ONE list: used by the server's CSP header and mirrored in docs/index.html's meta CSP (test/audit.cjs keeps them equal).
// web3auth.io: API, session, auth/account iframes, nodes. authnetwork.dev: Sapphire node endpoints (published at runtime, hosts vary). metadata.tor.us: key metadata.
module.exports = ['wss://*.web3auth.io', 'https://*.web3auth.io', 'https://*.authnetwork.dev', 'https://metadata.tor.us'];
