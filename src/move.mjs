// On-foot movement direction. Input: ix (+ = right), iy (+ = down / backward, screen convention: joystick down, S key), camYaw.
// The orbit camera sits at player + (sin camYaw, cos camYaw) * dist and looks at the player, so "forward" is -(sin, cos) of camYaw.
export function walkAngle(ix, iy, camYaw) { return Math.atan2(ix, iy) + camYaw; }
export function walkDir(ix, iy, camYaw) { const a = walkAngle(ix, iy, camYaw); return [Math.sin(a), Math.cos(a)]; }
