// Main stage layout shared by the client scene and the layout test (test/ui.cjs): the big DJ screen stands in FRONT of the stage, so the
// "$VWFEST SHOW GROUNDS" sign behind it must clear the screen's top edge when seen from the ground (it used to be hidden behind it).
module.exports = {
  SZ: -86,                                   // stage centre z
  SIGN: { w: 27, h: 6.75, y: 14.0, dz: -8.6 }, // sign on the back wall (centre height y, z = SZ + dz); 1024x256 texture, "SHOW GROUNDS" on its lower line
  SCREEN: { w: 14.4, h: 3.6, y: 5.2, dz: 10.62 }, // DJ / now-playing screen in front of the stage (z = SZ + dz), 1024x256 texture
};
