// On-foot controls: pushing the joystick up / W must move AWAY from the camera, right must move to the camera's right.
const assert = require('assert');
(async () => {
  const { walkDir } = await import('../src/move.mjs');
  let n = 0; const t = (name, f) => { f(); n++; console.log('ok  ', name); };
  for (const camYaw of [0, 0.7, Math.PI, -2.1, 4.4]) {
    const cam = [Math.sin(camYaw), Math.cos(camYaw)];               // camera offset from the player (main.js)
    const fwd = [-cam[0], -cam[1]];                                 // view direction on the ground
    const right = [-fwd[1], fwd[0]];                                // three.js camera: right = forward x up  ->  (-fz, fx)
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
    t(`camYaw ${camYaw.toFixed(2)}: joystick UP (iy<0) / W walks forward, away from the camera`, () => { const d = walkDir(0, -1, camYaw); assert(dot(d, fwd) > 0.999, JSON.stringify(d)); });
    t(`camYaw ${camYaw.toFixed(2)}: joystick DOWN / S walks back toward the camera`, () => { assert(dot(walkDir(0, 1, camYaw), cam) > 0.999); });
    t(`camYaw ${camYaw.toFixed(2)}: joystick RIGHT / D walks to the camera's right`, () => { assert(dot(walkDir(1, 0, camYaw), right) > 0.999); });
    t(`camYaw ${camYaw.toFixed(2)}: joystick LEFT / A walks to the camera's left`, () => { assert(dot(walkDir(-1, 0, camYaw), right) < -0.999); });
    t(`camYaw ${camYaw.toFixed(2)}: up-right diagonal is forward+right`, () => { const d = walkDir(1, -1, camYaw); assert(dot(d, fwd) > 0.7 && dot(d, right) > 0.7); });
  }
  console.log(`all ${n} movement tests passed`);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
