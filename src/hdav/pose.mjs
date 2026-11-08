// HD bone targets from the low-poly pose groups. Pure numbers so walk/emote behaviour can be tested without WebGL.
// Arm mapping matches the existing rig: low-poly aL drives the HD right arm, aR the left (groups were authored mirrored).
const clamp01 = (x) => Math.min(1, Math.max(0, x));
function arm(g, zBias) {
  const swing = g.x;
  // Resting elbow flex. Extra bend when the arm reaches forward, a little less when it swings back (the arm extends).
  const flex = 0.16 + Math.max(0, swing) * 0.32 + Math.max(0, -swing) * 0.1;
  return {
    upper: { x: swing, y: g.y, z: g.z + zBias },
    fore: { x: -flex, y: 0, z: swing * -0.06 },
    hand: { x: -0.12 - Math.max(0, swing) * 0.22, y: 0, z: g.z * 0.12 },
  };
}
function leg(g) {
  const lift = Math.max(0, g.x);
  return {
    shin: lift * 0.9 + 0.03, // same knee rule as the previous drive(): bend only on the forward swing
    foot: -lift * 0.32 - Math.min(0, g.x) * 0.12, // negative: toes up to clear; positive: a slight point as the leg trails
  };
}
// u is the low-poly upper-body rotation (lean / swagger / bow). Small leans keep the head nearer level;
// a deep emote (bow, nod) still carries the full pitch through the chain.
export function hdPoseTargets(u, aL, aR, lL, lR) {
  const pitch = u.x, yaw = u.y, roll = u.z;
  const follow = clamp01(Math.abs(pitch) / 0.5);
  const upright = 1 - follow;
  return {
    armR: arm(aL, -0.04),
    armL: arm(aR, 0.04),
    legR: leg(lL),
    legL: leg(lR),
    spine: { x: pitch * 0.42, y: yaw * 0.22, z: roll * 0.5 },
    chest: { x: pitch * 0.38, y: yaw * 0.28, z: roll * 0.35 },
    neck: { x: pitch * (0.12 - 0.2 * upright), y: yaw * 0.22, z: -roll * 0.12 * upright },
    head: { x: pitch * (0.08 - 0.25 * upright), y: yaw * 0.28, z: -roll * 0.16 * upright },
  };
}
export function chainPitch(t) { return t.spine.x + t.chest.x + t.neck.x + t.head.x; }
export function chainYaw(t) { return t.spine.y + t.chest.y + t.neck.y + t.head.y; }
