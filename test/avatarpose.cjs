// HD pose targets: elbow, wrist, foot, and how a lean is shared so a bow still reads and a small sway does not tip the face.
const assert = require('assert');
(async () => {
  const { hdPoseTargets, chainPitch, chainYaw } = await import('../src/hdav/pose.mjs');
  const z = { x: 0, y: 0, z: 0 };
  let n = 0; const t = (name, f) => { f(); n++; console.log('ok  ', name); };
  const sum = (o) => o.x + o.y + o.z;
  t('rest: elbows stay slightly bent, wrists relaxed, knees keep the old small bend', () => {
    const p = hdPoseTargets(z, z, z, z, z);
    assert(p.armR.fore.x < -0.14 && p.armR.fore.x > -0.2, 'fore ' + p.armR.fore.x);
    assert(p.armR.hand.x < -0.1 && p.armR.hand.x > -0.2, 'hand ' + p.armR.hand.x);
    assert(Math.abs(p.legR.shin - 0.03) < 1e-6, 'shin');
    assert(Math.abs(p.armR.upper.z + 0.04) < 1e-6 && Math.abs(p.armL.upper.z - 0.04) < 1e-6, 'rest abduction');
  });
  t('reaching forward bends the elbow more; swinging back extends it', () => {
    const fwd = hdPoseTargets(z, { x: 0.8, y: 0, z: 0 }, z, z, z);
    const back = hdPoseTargets(z, { x: -0.8, y: 0, z: 0 }, z, z, z);
    assert(fwd.armR.fore.x < back.armR.fore.x, 'forward elbow is more flexed');
    assert(fwd.armR.upper.x === 0.8 && back.armR.upper.x === -0.8, 'upper arm follows the low-poly swing');
    assert(fwd.armL.upper.x === 0, 'the other arm is not coupled');
  });
  t('low-poly aL still drives the HD right arm and aR the left', () => {
    const p = hdPoseTargets(z, { x: 0.2, y: 0, z: 0.5 }, { x: -0.3, y: 0, z: -0.4 }, z, z);
    assert(Math.abs(p.armR.upper.x - 0.2) < 1e-6 && Math.abs(p.armR.upper.z - 0.46) < 1e-6);
    assert(Math.abs(p.armL.upper.x + 0.3) < 1e-6 && Math.abs(p.armL.upper.z + 0.36) < 1e-6);
  });
  t('a lifted leg bends the knee and dorsiflexes the foot; a trailing leg points the toe', () => {
    const p = hdPoseTargets(z, z, z, { x: 0.7, y: 0, z: 0 }, { x: -0.5, y: 0, z: 0 });
    assert(p.legR.shin > 0.6, 'knee');
    assert(p.legR.foot < 0, 'toes up');
    assert(p.legL.shin === 0.03, 'trailing knee stays at the rest bend');
    assert(p.legL.foot > 0, 'trailing toe points slightly');
  });
  t('a deep bow keeps the full pitch through the spine chain', () => {
    const p = hdPoseTargets({ x: 0.9, y: 0, z: 0 }, z, z, z, z);
    assert(Math.abs(chainPitch(p) - 0.9) < 1e-6, 'pitch ' + chainPitch(p));
  });
  t('a small walk lean leaves the head nearer upright than the torso', () => {
    const p = hdPoseTargets({ x: 0.12, y: 0, z: 0 }, z, z, z, z);
    assert(chainPitch(p) < 0.12, 'world head pitch ' + chainPitch(p));
    assert(chainPitch(p) > 0.05, 'still leans a little');
    assert(p.head.x < p.spine.x, 'head counters relative to the spine');
  });
  t('look-around yaw still reaches the head', () => {
    const p = hdPoseTargets({ x: 0, y: 0.5, z: 0 }, z, z, z, z);
    assert(Math.abs(chainYaw(p) - 0.5) < 1e-6, 'yaw ' + chainYaw(p));
    assert(p.head.y > 0.1, 'face turns');
  });
  t('targets are finite for an emote-sized pose', () => {
    const p = hdPoseTargets({ x: 0.9, y: 0.4, z: 0.2 }, { x: -1.4, y: 0, z: 2.6 }, { x: 0.2, y: 0, z: -2.6 }, { x: -1.4, y: 0, z: 0 }, { x: -1.4, y: 0, z: 0 });
    for (const part of [p.armR, p.armL, p.legR, p.legL, p.spine, p.chest, p.neck, p.head]) {
      const vals = part.upper ? [part.upper, part.fore, part.hand] : part.shin !== undefined ? [{ x: part.shin }, { x: part.foot }] : [part];
      for (const v of vals) for (const k of Object.keys(v)) assert(Number.isFinite(v[k]), k);
    }
    assert(Number.isFinite(sum(p.head)));
  });
  console.log(`all ${n} avatar pose tests passed`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
